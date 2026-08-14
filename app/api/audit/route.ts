import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createServerClient();

  // entity_id is the food_listing this decision belongs to — the decision log
  // needs it to request a supply-chain plan for that listing.
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, created_at, details, entity_id')
    .eq('action', 'match_approved')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Entries logged before the per-branch breakdown was captured lack `candidates`
  // and can't render in the decision log — skip them rather than crash on them.
  const decisions = (data ?? []).filter((entry) => Array.isArray(entry.details?.candidates));

  return NextResponse.json({ decisions });
}
