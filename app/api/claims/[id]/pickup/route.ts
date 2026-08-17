import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireStaffKey } from '@/lib/staff-auth';

/**
 * Staff confirm a recipient actually collected a reserved item. This is the
 * missing other half of the claim lifecycle: `POST /api/claims` takes an item
 * from 'in_stock' to 'reserved', but nothing closed the loop from there —
 * once claimed, an item stayed 'reserved' forever with no way to mark it
 * picked up. `[id]` is the inventory_item_id, matching the URL shape of
 * `/api/fleet/[id]/advance`.
 *
 * Guarded the same way as every other status transition in this codebase: the
 * write is conditioned on the status we expect to find, so double-confirming
 * (two staff, or a double-click) produces one success and one 409 rather than
 * two writes racing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireStaffKey(request);
  if (authError) return authError;

  const { id } = await params;
  const supabase = createServerClient();

  const { data: updated, error: updateError } = await supabase
    .from('inventory_items')
    .update({ status: 'distributed' })
    .eq('id', id)
    .eq('status', 'reserved')
    .select('id')
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
  const { error: claimError } = await supabase
    .from('claims')
    .update({ status: 'picked_up', picked_up_at: nowIso })
    .eq('inventory_item_id', id)
    .eq('status', 'claimed');

  if (claimError) {
    console.error(
      `[claims/pickup] inventory_items ${id} marked distributed, but updating its claims row failed. ` +
        'The item is correctly picked up; the claims history for it will be stale. Cause:',
      claimError.message
    );
  }

  return NextResponse.json({ success: true });
}
