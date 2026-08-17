import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { planDispatchRuns } from '@/lib/dispatch-planning';
import { isOpenRun, type FleetRunRow, type VehicleRow } from '@/lib/fleet';
import type { Branch, InventoryItem } from '@/lib/types';

/**
 * Runs once daily at 6pm Singapore time (see vercel.json — `0 10 * * *` UTC)
 * and commits that day's most efficient per-branch partner-delivery route,
 * for every branch that has accumulated escalated (demand-quota-allocated)
 * stock since the last run. One `partner_dispatch_runs` row per branch,
 * carrying the same vehicle/route/proximity-optimized plan the read-only
 * `/api/dispatch` view already proposes — this is that exact same
 * computation (lib/dispatch-planning.ts), just persisted instead of only
 * ever shown live.
 *
 * A branch with nothing accumulated that day is skipped entirely — no empty
 * runs. A branch already dispatched today (the UNIQUE(branch_id,
 * dispatch_date) constraint) is skipped too, so a retried/duplicate cron
 * firing can't double-dispatch the same day's stock.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  // Singapore is UTC+8 with no DST — today's date there, not the server's.
  const dispatchDate = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

  const results: { branch_name: string; status: 'dispatched' | 'skipped' | 'failed'; reason?: string }[] = [];

  for (const run of runs) {
    // A run this branch already has today wins — idempotent against retries.
    const { data: existing } = await supabase
      .from('partner_dispatch_runs')
      .select('id')
      .eq('branch_id', run.branch_id)
      .eq('dispatch_date', dispatchDate)
      .maybeSingle();

    if (existing) {
      results.push({ branch_name: run.branch_name, status: 'skipped', reason: 'already dispatched today' });
      continue;
    }

    const { error: insertError } = await supabase.from('partner_dispatch_runs').insert({
      branch_id: run.branch_id,
      vehicle_id: run.suggested_vehicle
        ? vehicles.find((v) => v.label === run.suggested_vehicle!.label)?.id ?? null
        : null,
      dispatch_date: dispatchDate,
      item_count: run.item_count,
      total_kg: run.total_kg,
      total_distance_km: run.route.total_distance_km,
      total_minutes: run.route.total_minutes,
      stops: run.stops,
    });

    if (insertError) {
      console.error(`[cron/dispatch-partners] failed to dispatch ${run.branch_name}:`, insertError.message);
      results.push({ branch_name: run.branch_name, status: 'failed', reason: insertError.message });
    } else {
      results.push({ branch_name: run.branch_name, status: 'dispatched' });
    }
  }

  return NextResponse.json({ dispatch_date: dispatchDate, results });
}
