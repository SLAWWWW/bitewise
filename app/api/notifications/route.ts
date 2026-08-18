import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { planDispatchRuns } from '@/lib/dispatch-planning';
import { isOpenRun, type FleetRunRow, type VehicleRow } from '@/lib/fleet';
import type { Branch, InventoryItem, NotificationItem } from '@/lib/types';

/**
 * One aggregator across everything already computed elsewhere in the app —
 * pending approvals, dispatch (proposed and in-flight), storage (expired
 * stock, full racks), and the collection fleet — surfaced as a single feed
 * for the Network Overview page. Nothing here is a new signal; every count
 * traces back to a query/computation that already exists somewhere else
 * (the storage occupancy fix, the dispatch scheduler, etc) — this just
 * gathers them into one place instead of staff having to check five pages.
 */
export async function GET() {
  const supabase = createServerClient();
  const now = Date.now();
  const dispatchDate = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);

  const [
    pendingRes,
    inventoryRes,
    branchesRes,
    vehiclesRes,
    fleetRunsRes,
    dispatchedRes,
    claimsRes,
  ] = await Promise.all([
    supabase.from('food_listings').select('id, item_name, quantity_kg, created_at').eq('status', 'pending'),
    supabase.from('inventory_items').select('*'),
    supabase.from('branches').select('*'),
    supabase.from('vehicles').select('*'),
    supabase.from('fleet_runs').select('*'),
    supabase.from('partner_dispatch_runs').select('*').eq('dispatch_date', dispatchDate),
    supabase.from('claims').select('id, status, pickup_deadline_at').eq('status', 'claimed'),
  ]);

  const notifications: NotificationItem[] = [];

  // ── Pending approvals ──────────────────────────────────────────────────
  const pending = pendingRes.data ?? [];
  if (pending.length > 0) {
    const totalKg = pending.reduce((s, p) => s + (p.quantity_kg ?? 0), 0);
    notifications.push({
      id: 'pending-approvals',
      category: 'approval',
      severity: 'warning',
      title: `${pending.length} donation${pending.length === 1 ? '' : 's'} awaiting approval`,
      detail: `${Math.round(totalKg)}kg total — nothing reaches a branch until staff review it.`,
      count: pending.length,
      href: '/approvals',
    });
  }

  // ── Storage: expired stock + rack pressure ──────────────────────────────
  if (!inventoryRes.error) {
    const items = (inventoryRes.data ?? []) as InventoryItem[];
    const expired = items.filter((i) => i.status === 'expired');
    if (expired.length > 0) {
      const kg = expired.reduce((s, i) => s + (i.quantity ?? 0), 0);
      notifications.push({
        id: 'storage-expired',
        category: 'storage',
        severity: 'critical',
        title: `${expired.length} expired item${expired.length === 1 ? '' : 's'} awaiting recycling`,
        detail: `${Math.round(kg)}kg no longer safe to distribute, still occupying attention until cleared.`,
        count: expired.length,
        href: '/storage',
      });
    }

    const reservedUrgent = items.filter((i) => {
      if (i.status !== 'reserved') return false;
      // Deadlines aren't on inventory_items directly; approximated via
      // near-expiry reserved stock, which is the same practical signal
      // (a reservation about to time out is always also near its expiry).
      const hoursLeft = (new Date(i.expiry_at).getTime() - now) / 3_600_000;
      return hoursLeft > 0 && hoursLeft < 3;
    });
    if (reservedUrgent.length > 0) {
      notifications.push({
        id: 'reserved-urgent',
        category: 'storage',
        severity: 'warning',
        title: `${reservedUrgent.length} reservation${reservedUrgent.length === 1 ? '' : 's'} close to expiring unclaimed`,
        detail: 'Pickup window closing soon — may release back to public listing.',
        count: reservedUrgent.length,
        href: '/storage',
      });
    }
  }

  // ── Claims: public reservations awaiting pickup confirmation ────────────
  // Mirrors "awaiting delivery confirmation" for partner dispatch — a claim
  // being reserved doesn't mean the food is gone yet; staff (or the
  // recipient) still needs to actually hand it over and someone needs to hit
  // "Mark picked up" on /storage, or it just sits reserved until it times out.
  if (!claimsRes.error) {
    const claimed = claimsRes.data ?? [];
    if (claimed.length > 0) {
      const overdue = claimed.filter(
        (c) => c.pickup_deadline_at && new Date(c.pickup_deadline_at).getTime() < now
      );
      const dueSoon = claimed.filter((c) => {
        if (!c.pickup_deadline_at) return false;
        const hoursLeft = (new Date(c.pickup_deadline_at).getTime() - now) / 3_600_000;
        return hoursLeft > 0 && hoursLeft < 3;
      });

      if (overdue.length > 0) {
        notifications.push({
          id: 'claims-overdue',
          category: 'claims',
          severity: 'critical',
          title: `${overdue.length} claim${overdue.length === 1 ? '' : 's'} past their pickup deadline`,
          detail: 'Recipient never showed — release back to public listing or mark picked up if it already happened.',
          count: overdue.length,
          href: '/storage',
        });
      }
      if (dueSoon.length > 0) {
        notifications.push({
          id: 'claims-due-soon',
          category: 'claims',
          severity: 'warning',
          title: `${dueSoon.length} claim${dueSoon.length === 1 ? '' : 's'} due for pickup soon`,
          detail: 'Pickup window closing within 3 hours — confirm once the recipient collects it.',
          count: dueSoon.length,
          href: '/storage',
        });
      }
      const stillOpen = claimed.length - overdue.length - dueSoon.length;
      if (stillOpen > 0) {
        notifications.push({
          id: 'claims-awaiting-pickup',
          category: 'claims',
          severity: 'info',
          title: `${stillOpen} claim${stillOpen === 1 ? '' : 's'} awaiting pickup confirmation`,
          detail: 'Reserved by a recipient — hit "Mark picked up" on /storage once they collect it.',
          count: stillOpen,
          href: '/storage',
        });
      }
    }
  }

  // ── Dispatch: proposed-but-not-yet-sent, and in-flight today ────────────
  if (!branchesRes.error && !inventoryRes.error) {
    const branches = (branchesRes.data ?? []) as Branch[];
    const escalated = ((inventoryRes.data ?? []) as InventoryItem[]).filter((i) => i.status === 'escalated');
    const fleetAvailable = !vehiclesRes.error && !fleetRunsRes.error;
    const vehicles = (fleetAvailable ? vehiclesRes.data ?? [] : []) as VehicleRow[];
    const openRuns = (fleetAvailable ? fleetRunsRes.data ?? [] : []).filter((r) =>
      isOpenRun((r as FleetRunRow).status)
    ) as FleetRunRow[];

    const plannedRuns = planDispatchRuns({
      branches,
      escalatedItems: escalated,
      vehicles,
      openRuns,
      fleetAvailable,
      now,
    });

    const dispatchedBranchIds = new Set((dispatchedRes.data ?? []).map((d: { branch_id: string }) => d.branch_id));
    const awaitingDispatch = plannedRuns.filter((r) => !dispatchedBranchIds.has(r.branch_id));
    if (awaitingDispatch.length > 0) {
      const kg = awaitingDispatch.reduce((s, r) => s + r.total_kg, 0);
      notifications.push({
        id: 'awaiting-dispatch',
        category: 'dispatch',
        severity: 'info',
        title: `${awaitingDispatch.length} branch${awaitingDispatch.length === 1 ? '' : 'es'} with stock awaiting dispatch`,
        detail: `${Math.round(kg)}kg queued for partner delivery — dispatches automatically at 6pm.`,
        count: awaitingDispatch.length,
        href: '/dispatch',
      });
    }

    const atRisk = plannedRuns.filter((r) => r.route_exceeds_shelf_life);
    if (atRisk.length > 0) {
      notifications.push({
        id: 'dispatch-at-risk',
        category: 'dispatch',
        severity: 'critical',
        title: `${atRisk.length} dispatch route${atRisk.length === 1 ? '' : 's'} longer than the shelf life remaining`,
        detail: 'The drive alone eats the item\'s remaining safe window — split the run or drop the nearest stop first.',
        count: atRisk.length,
        href: '/dispatch',
      });
    }

    const ongoing = (dispatchedRes.data ?? []).filter((d: { status: string }) => d.status !== 'completed');
    if (ongoing.length > 0) {
      notifications.push({
        id: 'ongoing-dispatch',
        category: 'dispatch',
        severity: 'info',
        title: `${ongoing.length} partner dispatch${ongoing.length === 1 ? '' : 'es'} in progress today`,
        detail: 'Committed at 6pm, on the road to their assigned partners.',
        count: ongoing.length,
        href: '/dispatch',
      });
    }

    // Dispatched but not yet closed out — staff still need to hit "Confirm
    // delivered" on /storage for each of these once the drop-off actually
    // happens, or they sit in 'escalated' status forever (the same gap
    // "Confirm delivered" itself was built to close — this is the reminder
    // that the action is still outstanding, not just that a run exists).
    const awaitingConfirmation = escalated.filter((i) => dispatchedBranchIds.has(i.branch_id));
    if (awaitingConfirmation.length > 0) {
      const kg = awaitingConfirmation.reduce((s, i) => s + (i.quantity ?? 0), 0);
      notifications.push({
        id: 'awaiting-delivery-confirmation',
        category: 'dispatch',
        severity: 'warning',
        title: `${awaitingConfirmation.length} item${awaitingConfirmation.length === 1 ? '' : 's'} awaiting delivery confirmation`,
        detail: `${Math.round(kg)}kg dispatched today — hit "Confirm delivered" once each drop-off actually happens.`,
        count: awaitingConfirmation.length,
        href: '/storage',
      });
    }
  }

  // ── Fleet: active collection runs + offline vehicles ────────────────────
  if (!fleetRunsRes.error && !vehiclesRes.error) {
    const fleetRuns = (fleetRunsRes.data ?? []) as FleetRunRow[];
    const vehicles = (vehiclesRes.data ?? []) as VehicleRow[];
    const active = fleetRuns.filter((r) => isOpenRun(r.status));
    if (active.length > 0) {
      notifications.push({
        id: 'fleet-active',
        category: 'fleet',
        severity: 'info',
        title: `${active.length} collection run${active.length === 1 ? '' : 's'} in progress`,
        detail: 'Vehicles currently assigned, en route, or holding a pickup.',
        count: active.length,
        href: '/logistics',
      });
    }

    const offline = vehicles.filter((v) => v.is_offline);
    if (offline.length > 0) {
      notifications.push({
        id: 'fleet-offline',
        category: 'fleet',
        severity: 'warning',
        title: `${offline.length} vehicle${offline.length === 1 ? '' : 's'} offline`,
        detail: 'Off the road — reduces available capacity for new collection or dispatch runs.',
        count: offline.length,
        href: '/logistics',
      });
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  notifications.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return NextResponse.json({ notifications });
}
