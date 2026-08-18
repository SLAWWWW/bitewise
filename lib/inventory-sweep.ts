import type { createServerClient } from '@/lib/supabase-server';

type SupabaseServerClient = ReturnType<typeof createServerClient>;

/**
 * An 'escalated' item is already committed to a specific partner beneficiary
 * — unlike a public 'in_stock'/'reserved' listing, there's no walk-in
 * claimant who might still show up, so the "expired, staff hits Recycle on
 * the Storage page" checkpoint that makes sense for public stock doesn't
 * apply here. If one spoils before staff can confirm delivery, auto-complete
 * it as recycled immediately instead of leaving it stuck showing a stale
 * "Expired on the shelf" label with no partner ever having received it.
 */
export async function autoRecycleExpiredEscalations(supabase: SupabaseServerClient) {
  const { data: expired, error } = await supabase
    .from('inventory_items')
    .select('id, listing_id')
    .eq('status', 'escalated')
    .lt('expiry_at', new Date().toISOString());

  if (error) {
    console.error('[inventory-sweep] could not query past-expiry escalations:', error.message);
    return;
  }
  if (!expired || expired.length === 0) return;

  for (const item of expired) {
    const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', item.id);
    if (deleteError) {
      console.error(`[inventory-sweep] could not auto-recycle escalated item ${item.id}:`, deleteError.message);
      continue;
    }

    if (item.listing_id) {
      const { error: stampError } = await supabase
        .from('food_listings')
        .update({ status: 'expired', delivered_at: new Date().toISOString(), completed_via: 'recycled' })
        .eq('id', item.listing_id);
      if (stampError) {
        console.error(
          `[inventory-sweep] could not stamp listing ${item.listing_id} as recycled — likely migration 013 not applied yet. Cause:`,
          stampError.message
        );
      }
    } else {
      console.error(
        `[inventory-sweep] escalated item ${item.id} auto-recycled but had no listing_id — ` +
          'its food_listings row could not be stamped as completed. Likely created before ' +
          '007_inventory_provenance.sql was applied.'
      );
    }
  }
}
