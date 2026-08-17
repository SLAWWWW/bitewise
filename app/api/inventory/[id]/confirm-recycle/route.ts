import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

/**
 * Staff confirm an expired item has been sent for food-waste recycling —
 * the closing action that didn't exist before: an expired item just sat in
 * `'expired'` status forever, still counted toward rack occupancy (see the
 * fix in app/api/storage/route.ts), with no way to actually clear it out.
 * `[id]` is the inventory_item_id, matching the URL shape of
 * `/api/claims/[id]/pickup` and `/api/inventory/[id]/confirm-delivery`.
 *
 * Simpler than either sibling route: there's no partner allocation or
 * recipient impact to credit here, since recycling isn't a redistribution
 * outcome — just guard on the status expected, then delete.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: updated, error: checkError } = await supabase
    .from('inventory_items')
    .select('id, listing_id')
    .eq('id', id)
    .eq('status', 'expired')
    .maybeSingle();

  if (checkError) {
    return NextResponse.json({ error: checkError.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      { success: false, message: 'This item is not currently marked expired.' },
      { status: 409 }
    );
  }

  const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // Stamp the listing with its final outcome, same as the other two
  // completion routes — best-effort, missing migration 013 just means this
  // one won't show up in History or get a distinct closed-out label.
  if (updated.listing_id) {
    const { error: completeError } = await supabase
      .from('food_listings')
      .update({ status: 'expired', delivered_at: new Date().toISOString(), completed_via: 'recycled' })
      .eq('id', updated.listing_id);
    if (completeError) {
      console.error(
        `[inventory/confirm-recycle] could not stamp listing ${updated.listing_id} as completed — likely migration 013 not applied yet. Cause:`,
        completeError.message
      );
    }
  }

  return NextResponse.json({ success: true });
}
