import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { computePipelineEntry, type PipelineListingRow } from '@/lib/pipeline';
import type { PipelineEntry } from '@/lib/types';

const RECENT_LIMIT = 12;

/**
 * The Command Center's donation flow: the most recent listings with their
 * *real* current stage, not just `food_listings.status` (which stops at
 * 'matched' forever — the rest of the journey lives in fleet_runs and
 * inventory_items). Lets staff see, and act on, one donation's whole journey
 * from a single row instead of piecing it together across three pages.
 */
export async function GET() {
  const supabase = createServerClient();

  const BASE_COLUMNS =
    'id, item_name, food_type, quantity_kg, storage_type, expiry_at, agreed_to_regulations, created_at, status, decision_details, donor:donors(id, name, type, address, status)';

  // Completed donations belong in the History panel now, not the active
  // work feed — otherwise a finished donation just sits here, showing a
  // stale stage label, until 12 newer listings eventually push it out.
  // completed_via/delivered_at require migration 013; retry without the
  // filter (and the columns) so this still works before it's applied.
  let listings: unknown[] | null;
  let listingsError: { message: string } | null;
  {
    const res = await supabase
      .from('food_listings')
      .select(`${BASE_COLUMNS}, delivered_at, completed_via`)
      .is('delivered_at', null)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT);
    listings = res.data;
    listingsError = res.error;
  }

  if (listingsError) {
    const res = await supabase
      .from('food_listings')
      .select(BASE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT);
    listings = res.data;
    listingsError = res.error;
  }

  if (listingsError) {
    return NextResponse.json({ error: listingsError.message }, { status: 500 });
  }

  const rows = (listings ?? []) as unknown as PipelineListingRow[];
  const ids = rows.map((r) => r.id);

  const [runsRes, vehiclesRes, invRes] = await Promise.all([
    ids.length
      ? supabase.from('fleet_runs').select('id, listing_id, vehicle_id, status').in('listing_id', ids)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('vehicles').select('id, label, driver_name'),
    ids.length
      ? supabase.from('inventory_items').select('listing_id, status').in('listing_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const vehicleById = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v]));
  const runByListing = new Map((runsRes.data ?? []).map((r) => [r.listing_id, r]));
  const invByListing = new Map((invRes.data ?? []).map((i) => [i.listing_id, i]));

  const entries: PipelineEntry[] = rows.map((row) => {
    const run = runByListing.get(row.id);
    return computePipelineEntry(
      row,
      invByListing.get(row.id),
      run,
      run ? vehicleById.get(run.vehicle_id) : undefined
    );
  });

  return NextResponse.json({ entries });
}
