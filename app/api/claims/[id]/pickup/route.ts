import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

/**
 * Staff confirm a recipient actually collected a reserved item — and, now
 * that this is the required gate before an item's record can be cleared,
 * the item's row is deleted once confirmed rather than lingering forever
 * with a "Picked up" badge. `[id]` is the inventory_item_id, matching the
 * URL shape of `/api/fleet/[id]/advance`.
 *
 * Guarded the same way as every other status transition in this codebase: the
 * write is conditioned on the status we expect to find, so double-confirming
 * (two staff, or a double-click) produces one success and one 409 rather than
 * two writes racing.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: updated, error: updateError } = await supabase
    .from('inventory_items')
    .update({ status: 'distributed' })
    .eq('id', id)
    .eq('status', 'reserved')
    .select('id, quantity, listing_id')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      { success: false, message: 'This item is not currently reserved — it may already be picked up.' },
      { status: 409 }
    );
  }

  // Best-effort: the pickup is already committed above. A missing or
  // already-consumed claims row (e.g. legacy items reserved before this
  // endpoint existed) shouldn't undo the confirmed pickup.
  const nowIso = new Date().toISOString();
  const { data: claimRow, error: claimError } = await supabase
    .from('claims')
    .update({ status: 'picked_up', picked_up_at: nowIso })
    .eq('inventory_item_id', id)
    .eq('status', 'claimed')
    .select('profile_id')
    .maybeSingle();

  if (claimError) {
    console.error(
      `[claims/pickup] inventory_items ${id} marked distributed, but updating its claims row failed. ` +
        'The item is correctly picked up; the claims history for it will be stale. Cause:',
      claimError.message
    );
  }

  // Attribute the kg to the recipient's lifetime impact before the row
  // holding that quantity is gone — best-effort so a missing migration 011
  // (no RPC yet) degrades to "impact not tracked", not a blocked pickup.
  if (claimRow?.profile_id) {
    const { error: impactError } = await supabase.rpc('increment_recipient_impact', {
      p_profile_id: claimRow.profile_id,
      p_kg: updated.quantity,
    });
    if (impactError) {
      console.error(
        `[claims/pickup] could not credit recipient ${claimRow.profile_id} with ${updated.quantity}kg — ` +
          'likely migration 011 not applied yet. Cause:',
        impactError.message
      );
    }
  }

  // The item has been confirmed collected — its record no longer needs to
  // occupy the active database. Best-effort: if this fails (e.g. migration
  // 011 hasn't been run, so claims.inventory_item_id still blocks deletes),
  // the item stays visible as 'distributed', matching the previous behavior,
  // rather than the confirmed pickup itself failing.
  const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', id);
  if (deleteError) {
    console.error(
      `[claims/pickup] inventory_items ${id} confirmed picked up but could not be deleted — ` +
        'likely migration 011 not applied yet (claims FK still blocks it). Cause:',
      deleteError.message
    );
  }

  // Stamp the listing with its final outcome — the only thing that survives
  // once the inventory row above is gone, so the item page and Agent
  // Decisions stop showing a stale "publicly listed" label forever, and the
  // History panel has something to show. Best-effort: missing migration 013
  // degrades to the pre-existing (stale-label) behavior, not a failed pickup.
  if (updated.listing_id) {
    const { error: completeError } = await supabase
      .from('food_listings')
      .update({ status: 'delivered', delivered_at: new Date().toISOString(), completed_via: 'public_pickup' })
      .eq('id', updated.listing_id);
    if (completeError) {
      console.error(
        `[claims/pickup] could not stamp listing ${updated.listing_id} as completed — likely migration 013 not applied yet. Cause:`,
        completeError.message
      );
    }
  } else {
    console.error(
      `[claims/pickup] item ${id} confirmed picked up but had no listing_id — ` +
        'its food_listings row could not be stamped as completed and will keep showing a stale stage label. ' +
        'Likely created before 007_inventory_provenance.sql was applied.'
    );
  }

  return NextResponse.json({ success: true });
}
