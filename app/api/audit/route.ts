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
  const withCandidates = (data ?? []).filter((entry) => Array.isArray(entry.details?.candidates));

  // entity_id has no foreign key (it's a bare TEXT column, since audit_log
  // logs several unrelated entity types) — deleting a food_listings row
  // directly (e.g. test-data cleanup) silently orphans any audit_log row
  // that referenced it. A decision whose listing no longer exists links to
  // a dead page, so drop it here rather than let the UI find out by 404ing.
  const entityIds = withCandidates.map((entry) => entry.entity_id).filter((id): id is string => !!id);
  const { data: existingListings } = entityIds.length
    ? await supabase.from('food_listings').select('id').in('id', entityIds)
    : { data: [] as { id: string }[] };
  const liveIds = new Set((existingListings ?? []).map((l) => l.id));

  const decisions = withCandidates.filter((entry) => !entry.entity_id || liveIds.has(entry.entity_id));

  return NextResponse.json({ decisions });
}
