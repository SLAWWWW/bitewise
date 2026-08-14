import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import type { ApprovalActionResponse } from '@/lib/types';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: listing, error: fetchError } = await supabase
    .from('food_listings')
    .select('id, status')
    .eq('id', id)
    .single();

  if (fetchError || !listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }
  if (listing.status !== 'pending') {
    const response: ApprovalActionResponse = { success: false, message: 'This listing was already reviewed.' };
    return NextResponse.json(response, { status: 409 });
  }

  const { data: claimedRows } = await supabase
    .from('food_listings')
    .update({ status: 'cancelled', reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (!claimedRows || claimedRows.length === 0) {
    const response: ApprovalActionResponse = { success: false, message: 'This listing was already reviewed.' };
    return NextResponse.json(response, { status: 409 });
  }

  const { error: rejectAuditError } = await supabase.from('audit_log').insert({
    actor_type: 'ngo_staff',
    action: 'match_rejected',
    entity_type: 'food_listing',
    entity_id: id,
    details: {},
  });
  if (rejectAuditError) {
    console.error(
      `[reject] audit_log 'match_rejected' insert failed for listing ${id}. ` +
        'The listing was cancelled but this action will not appear in the audit trail. Cause:',
      rejectAuditError.message
    );
  }

  const response: ApprovalActionResponse = { success: true };
  return NextResponse.json(response);
}
