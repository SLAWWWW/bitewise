import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { vehicleStatus, isOpenRun, type FleetRunRow, type VehicleRow } from '@/lib/fleet';
import type { Branch } from '@/lib/types';

/**
 * The fleet board: every vehicle with its derived live status, its current run
 * if any, and each branch's coverage summary.
 *
 * Also returns recently closed runs so the page can show a log rather than only
 * a snapshot — "track progress of fleet" needs history, not just current state.
 */
export async function GET() {
  const supabase = createServerClient();

  const [vehiclesRes, runsRes, branchesRes] = await Promise.all([
    supabase.from('vehicles').select('*').order('label'),
    supabase
      .from('fleet_runs')
      .select('*, listing:food_listings(item_name, quantity_kg, food_type, storage_type, expiry_at, donor:donors(name, address))')
      .order('assigned_at', { ascending: false })
      .limit(60),
    supabase.from('branches').select('*').order('name'),
  ]);

  // The fleet tables only exist once 006_fleet.sql has been run. Say so plainly
  // instead of returning an empty board that looks like "no vehicles".
  //
  // Answered 200 with a typed payload rather than 5xx: this is a known setup
  // state the page renders a proper message for, and a non-2xx here would spray
  // console errors in the browser that read like a real fault.
  if (vehiclesRes.error || runsRes.error) {
    return NextResponse.json({
      error: 'fleet_unavailable',
      message: 'The fleet tables are missing. Run supabase/migrations/006_fleet.sql, then reload.',
      detail: vehiclesRes.error?.message ?? runsRes.error?.message,
      fleet: [],
      coverage: [],
      history: [],
    });
  }
  if (branchesRes.error) {
    return NextResponse.json({ error: branchesRes.error.message }, { status: 500 });
  }

  const vehicles = (vehiclesRes.data ?? []) as VehicleRow[];
  const runs = (runsRes.data ?? []) as (FleetRunRow & { listing?: unknown })[];
  const branches = (branchesRes.data ?? []) as Branch[];

  const openByVehicle = new Map<string, FleetRunRow>();
  for (const r of runs) {
    if (isOpenRun(r.status) && !openByVehicle.has(r.vehicle_id)) openByVehicle.set(r.vehicle_id, r);
  }

  const branchById = new Map(branches.map((b) => [b.id, b]));

  const fleet = vehicles.map((v) => {
    const openRun = openByVehicle.get(v.id);
    const status = vehicleStatus(v, openRun);
    const serving = openRun ? branchById.get(openRun.serving_branch_id) : undefined;
    return {
      ...v,
      status,
      home_branch_name: branchById.get(v.branch_id)?.name ?? 'Unknown',
      current_run: openRun
        ? {
            ...openRun,
            serving_branch_name: serving?.name ?? 'Unknown',
            // On loan when it's working for a branch other than its own.
            is_cross_branch: openRun.serving_branch_id !== v.branch_id,
          }
        : null,
    };
  });

  // Per-branch coverage — the number staff actually act on.
  const coverage = branches.map((b) => {
    const own = fleet.filter((v) => v.branch_id === b.id);
    const idle = own.filter((v) => v.status === 'idle');
    const borrowedIn = fleet.filter(
      (v) => v.branch_id !== b.id && v.current_run?.serving_branch_id === b.id
    );
    const lentOut = own.filter((v) => v.current_run?.is_cross_branch);
    return {
      branch_id: b.id,
      branch_name: b.name,
      area: b.area,
      color: b.color,
      total: own.length,
      idle: idle.length,
      active: own.filter((v) => v.status !== 'idle' && v.status !== 'offline').length,
      offline: own.filter((v) => v.status === 'offline').length,
      has_refrigerated_idle: idle.some((v) => v.type === 'refrigerated'),
      borrowed_in: borrowedIn.length,
      lent_out: lentOut.length,
    };
  });

  const history = runs.filter((r) => !isOpenRun(r.status)).slice(0, 24);

  return NextResponse.json({ fleet, coverage, history });
}
