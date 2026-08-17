import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

/**
 * Staff confirm an escalated item was actually delivered to the partner
 * beneficiary it was routed to. This closing action didn't exist before —
 * an escalated item just sat in `'escalated'` status indefinitely (or got
 * swept to `'expired'` if nobody ever closed the loop). `[id]` is the
 * inventory_item_id, matching `/api/claims/[id]/pickup`'s public-claim
 * counterpart.
 *
 * Same pattern as that route: guarded on the status expected, then the
 * item's row is deleted once confirmed rather than lingering forever.
 * `beneficiary_allocations.inventory_item_id` is `ON DELETE SET NULL`
 * (008), so the partner-allocation history row survives this delete —
 * unlike a public claim, there's no per-recipient running total to credit
 * here, since the beneficiary is an organisation, not a claimant.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: updated, error: updateError } = await supabase
    .from('inventory_items')
    .update({ status: 'distributed' })
    .eq('id', id)
    .eq('status', 'escalated')
    .select('id, branch_id, listing_id')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      { success: false, message: 'This item is not currently awaiting partner delivery.' },
      { status: 409 }
    );
  }

  const { error: deleteError } = await supabase.from('inventory_items').delete().eq('id', id);
  if (deleteError) {
    console.error(
      `[inventory/confirm-delivery] ${id} confirmed delivered but could not be deleted. Cause:`,
      deleteError.message
    );
  }

  // Stamp the listing with its final outcome — this is what fixes an item
  // that started as a genuine public listing but was later escalated: once
  // its inventory_items row is deleted, this is the only surviving record
  // that it actually ended up delivered to a partner, not just "public
  // listing" forever. Best-effort: missing migration 013 degrades to the
  // pre-existing stale-label behavior, not a failed delivery confirmation.
  if (updated.listing_id) {
    const { error: completeError } = await supabase
      .from('food_listings')
      .update({ status: 'delivered', delivered_at: new Date().toISOString(), completed_via: 'partner_delivery' })
      .eq('id', updated.listing_id);
    if (completeError) {
      console.error(
        `[inventory/confirm-delivery] could not stamp listing ${updated.listing_id} as completed — likely migration 013 not applied yet. Cause:`,
        completeError.message
      );
    }
  }

  // If this was the last escalated item at this branch, today's dispatch run
  // (if one exists — migration 012) is actually finished, not just "in
  // progress" — without this, the "ongoing dispatch" notification would
  // stay lit forever after the real work is already done.
  const { count: remaining } = await supabase
    .from('inventory_items')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', updated.branch_id)
    .eq('status', 'escalated');

  if (!remaining) {
    const dispatchDate = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    const { error: completeError } = await supabase
      .from('partner_dispatch_runs')
      .update({ status: 'completed' })
      .eq('branch_id', updated.branch_id)
      .eq('dispatch_date', dispatchDate)
      .neq('status', 'completed');
    if (completeError) {
      console.error(
        `[inventory/confirm-delivery] could not mark branch ${updated.branch_id}'s dispatch run completed — ` +
          'likely migration 012 not applied yet. Cause:',
        completeError.message
      );
    }
  }

  return NextResponse.json({ success: true });
}
