import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { beneficiariesForArea, type PartnerBeneficiary } from '@/lib/data/beneficiaries';
import { optimiseRoute, type RouteStop } from '@/lib/routing';
import { describeShelfLife } from '@/lib/storage-zones';
import { rankDispatchCandidates, isOpenRun, type FleetRunRow, type VehicleRow } from '@/lib/fleet';
import { ESCALATION_THRESHOLD_HOURS } from '@/lib/constants';
import type { Branch, InventoryItem } from '@/lib/types';

/** Cold-chain food can only go to a partner that can receive it that way. */
function partnerAccepts(partner: PartnerBeneficiary, item: InventoryItem): boolean {
  const needsCold = item.storage_type === 'cold' || item.storage_type === 'frozen';
  if (needsCold && !partner.accepts.needs_cold_chain) return false;
  if (item.food_type === 'cooked' && !partner.accepts.cooked) return false;
  return true;
}

/**
 * Partner dispatch planning.
 *
 * Takes every item that has escalated past public claiming, groups it by branch,
 * assigns each item to the nearest partner that can actually receive it, then
 * computes the shortest multi-stop route from the branch through those partners.
 *
 * Deliberately read-only: it proposes runs, it doesn't create them. Same
 * principle as routing — the system recommends, staff commit.
 */
export async function GET() {
  const supabase = createServerClient();

  const [branchesRes, itemsRes, vehiclesRes, runsRes] = await Promise.all([
    supabase.from('branches').select('*').order('name'),
    supabase.from('inventory_items').select('*').eq('status', 'escalated').order('expiry_at'),
    supabase.from('vehicles').select('*'),
    supabase.from('fleet_runs').select('*'),
  ]);

  if (branchesRes.error) return NextResponse.json({ error: branchesRes.error.message }, { status: 500 });
  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });

  const branches = (branchesRes.data ?? []) as Branch[];
  const escalated = (itemsRes.data ?? []) as InventoryItem[];

  // Fleet is optional here — dispatch planning still works without 006 applied,
  // it just can't say which vehicle would carry the run.
  const fleetAvailable = !vehiclesRes.error && !runsRes.error;
  const vehicles = (fleetAvailable ? vehiclesRes.data ?? [] : []) as VehicleRow[];
  const openRuns = (fleetAvailable ? runsRes.data ?? [] : []).filter((r) =>
    isOpenRun((r as FleetRunRow).status)
  ) as FleetRunRow[];

  const now = Date.now();

  const runs = branches
    .map((branch) => {
      // Only still-edible stock is worth planning a run for. Anything already
      // past expiry belongs in a write-off, not a delivery van — it shows on the
      // storage page as expired rather than silently padding this board.
      const items = escalated.filter(
        (i) => i.branch_id === branch.id && new Date(i.expiry_at).getTime() > now
      );
      if (items.length === 0) return null;

      const partners = beneficiariesForArea(branch.area);

      // Each item goes to the nearest partner that can receive it.
      const assignments = items.map((item) => {
        const partner = partners.find((p) => partnerAccepts(p, item)) ?? partners[0];
        const shelf = describeShelfLife(item.expiry_at, now);
        return {
          item_id: item.id,
          item_name: item.item_name,
          food_type: item.food_type,
          storage_type: item.storage_type,
          quantity: item.quantity,
          unit: item.unit,
          shelf_life_label: shelf.label,
          shelf_life_hours: Number(shelf.hours.toFixed(2)),
          urgency: shelf.tier,
          partner_name: partner.name,
          partner_type: partner.type.replace(/_/g, ' '),
          // Flagged when nothing in the region can properly take it.
          compromised: !partnerAccepts(partner, item),
        };
      });

      // One stop per distinct partner, carrying all items bound for it.
      const stopNames = [...new Set(assignments.map((a) => a.partner_name))];
      const stops: RouteStop[] = stopNames.map((name) => {
        const p = partners.find((x) => x.name === name)!;
        return { id: name, name, lat: p.lat, lng: p.lng };
      });

      const route = optimiseRoute(
        { id: branch.id, name: branch.name.replace('Willing Hearts — ', ''), lat: branch.lat, lng: branch.lng },
        stops
      );

      const totalKg = assignments.reduce((s, a) => s + (a.quantity ?? 0), 0);
      const needsColdChain = items.some(
        (i) => i.storage_type === 'cold' || i.storage_type === 'frozen'
      );

      const candidates = fleetAvailable
        ? rankDispatchCandidates({
            vehicles,
            openRuns,
            branches: branches.map((b) => ({ id: b.id, name: b.name, lat: b.lat, lng: b.lng })),
            servingBranchId: branch.id,
            quantityKg: totalKg,
            needsColdChain,
          })
        : [];

      const soonest = Math.min(...assignments.map((a) => a.shelf_life_hours));

      return {
        branch_id: branch.id,
        branch_name: branch.name,
        area: branch.area,
        color: branch.color,
        item_count: assignments.length,
        total_kg: Number(totalKg.toFixed(1)),
        needs_cold_chain: needsColdChain,
        soonest_expiry_hours: Number(soonest.toFixed(2)),
        // True when the drive alone eats the remaining shelf life.
        route_exceeds_shelf_life: route.total_minutes / 60 > soonest,
        assignments,
        stops: route.order.map((s, i) => {
          const p = partners.find((x) => x.name === s.name)!;
          const forStop = assignments.filter((a) => a.partner_name === s.name);
          return {
            sequence: i + 1,
            name: s.name,
            type: p.type.replace(/_/g, ' '),
            serves: p.serves,
            note: p.note,
            items: forStop.length,
            kg: Number(forStop.reduce((sum, a) => sum + (a.quantity ?? 0), 0).toFixed(1)),
          };
        }),
        route: {
          legs: route.legs,
          total_distance_km: route.total_distance_km,
          total_minutes: route.total_minutes,
          method: route.method,
          permutations_considered: route.permutations_considered,
        },
        suggested_vehicle: candidates[0]
          ? {
              label: candidates[0].vehicle.label,
              type: candidates[0].vehicle.type,
              driver_name: candidates[0].vehicle.driver_name,
              capacity_kg: candidates[0].vehicle.capacity_kg,
              is_cross_branch: candidates[0].is_cross_branch,
              home_branch_name: candidates[0].home_branch_name,
            }
          : null,
        fleet_available: fleetAvailable,
        no_vehicle_reason: !fleetAvailable
          ? 'Fleet tables not set up — run migration 006 to see vehicle suggestions.'
          : candidates.length === 0
            ? needsColdChain
              ? 'No refrigerated vehicle free anywhere in the network right now.'
              : 'No vehicle with enough capacity is free right now.'
            : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    // Most urgent branch first.
    .sort((a, b) => a.soonest_expiry_hours - b.soonest_expiry_hours);

  return NextResponse.json({
    runs,
    summary: {
      escalation_threshold_hours: ESCALATION_THRESHOLD_HOURS,
      branches_with_dispatch: runs.length,
      total_items: runs.reduce((s, r) => s + r.item_count, 0),
      total_kg: Number(runs.reduce((s, r) => s + r.total_kg, 0).toFixed(1)),
      total_distance_km: Number(runs.reduce((s, r) => s + r.route.total_distance_km, 0).toFixed(2)),
      people_reached: runs.reduce((s, r) => s + r.stops.reduce((x, st) => x + st.serves, 0), 0),
      at_risk_runs: runs.filter((r) => r.route_exceeds_shelf_life).length,
    },
  });
}
