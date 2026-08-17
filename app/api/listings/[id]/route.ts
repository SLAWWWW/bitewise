import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { computePipelineEntry, type PipelineListingRow } from '@/lib/pipeline';

/**
 * One donation's full detail — powers the dedicated item page. Same stage
 * derivation as `/api/pipeline` (via the shared `computePipelineEntry`), just
 * for a single id instead of the 12 most recent, so the two can never
 * disagree about where a donation actually is.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const BASE_COLUMNS =
    'id, item_name, food_type, quantity_kg, storage_type, expiry_at, agreed_to_regulations, created_at, status, decision_details, donor:donors(id, name, type, address, status)';

  // completed_via/delivered_at require migration 013 — retry without them so
  // this page still works before it's applied, just without the fix for
  // stale post-completion stage labels.
  let { data: row, error: listingError } = await supabase
    .from('food_listings')
    .select(`${BASE_COLUMNS}, delivered_at, completed_via`)
    .eq('id', id)
    .maybeSingle();

  if (listingError) {
    ({ data: row, error: listingError } = await supabase
      .from('food_listings')
      .select(BASE_COLUMNS)
      .eq('id', id)
      .maybeSingle());
  }

  if (listingError) {
    return NextResponse.json({ error: listingError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  const [runRes, invRes] = await Promise.all([
    supabase.from('fleet_runs').select('id, listing_id, vehicle_id, status').eq('listing_id', id).maybeSingle(),
    supabase.from('inventory_items').select('listing_id, status').eq('listing_id', id).maybeSingle(),
  ]);

  const run = runRes.data ?? undefined;
  let vehicle: { id: string; label: string; driver_name: string } | undefined;
  if (run) {
    const { data: v } = await supabase
      .from('vehicles')
      .select('id, label, driver_name')
      .eq('id', run.vehicle_id)
      .maybeSingle();
    vehicle = v ?? undefined;
  }

  const entry = computePipelineEntry(row as unknown as PipelineListingRow, invRes.data ?? undefined, run, vehicle);

  return NextResponse.json({ entry });
}
