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
    .select('id')
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

  return NextResponse.json({ success: true });
}
