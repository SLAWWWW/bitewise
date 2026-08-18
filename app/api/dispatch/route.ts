import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { planDispatchRuns } from '@/lib/dispatch-planning';
import { isOpenRun, type FleetRunRow, type VehicleRow } from '@/lib/fleet';
import { ESCALATION_THRESHOLD_HOURS } from '@/lib/constants';
import type { Branch, InventoryItem } from '@/lib/types';

/**
 * Partner dispatch planning — the live, always-current view of what dispatch
 * would look like right now. Read-only: it proposes routes, it doesn't
 * create them. Actual dispatch commits immediately and automatically —
 * `runDispatchSweep` (lib/dispatch-planning.ts) is called right when a branch
 * first has escalated stock and no run already in flight, from wherever that
 * happens (approval, the near-expiry sweep) — so this view and what actually
 * got committed can never disagree about what "efficient" means, and nothing
 * here is waiting on a schedule.
 */
export async function GET() {
  const supabase = createServerClient();

  const [branchesRes, itemsRes, vehiclesRes, runsRes, dispatchedRes] = await Promise.all([
    supabase.from('branches').select('*').order('name'),
    supabase.from('inventory_items').select('*').eq('status', 'escalated').order('expiry_at'),
    supabase.from('vehicles').select('*'),
    supabase.from('fleet_runs').select('*'),
    // Optional — migration 012/014. A branch with a dispatch already in
    // flight shows that instead of an ever-changing live proposal for the
    // same stock, so staff aren't looking at a "proposal" for a run that's
    // already locked in.
    supabase.from('partner_dispatch_runs').select('branch_id, created_at').neq('status', 'completed'),
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

  const runs = planDispatchRuns({
    branches,
    escalatedItems: escalated,
    vehicles,
    openRuns,
    fleetAvailable,
    now: Date.now(),
  });

  const dispatchedAtByBranch = new Map(
    (dispatchedRes.data ?? []).map((d: { branch_id: string; created_at: string }) => [d.branch_id, d.created_at])
  );
  const runsWithStatus = runs.map((r) => ({
    ...r,
    dispatched_at: dispatchedAtByBranch.get(r.branch_id) ?? null,
  }));

  return NextResponse.json({
    runs: runsWithStatus,
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
