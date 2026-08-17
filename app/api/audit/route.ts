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
  //
  // Also excludes anything already completed (delivered_at set) — a
  // finished donation belongs in the History panel, not the active
  // decisions feed forever. Falls back to just the liveness check if
  // migration 013 (delivered_at) isn't applied yet.
  const entityIds = withCandidates.map((entry) => entry.entity_id).filter((id): id is string => !!id);
  let stillActiveIds: Set<string>;
  if (entityIds.length === 0) {
    stillActiveIds = new Set();
  } else {
    const { data: activeListings, error: activeError } = await supabase
      .from('food_listings')
      .select('id')
      .in('id', entityIds)
      .is('delivered_at', null);
    if (activeError) {
      const { data: existingListings } = await supabase.from('food_listings').select('id').in('id', entityIds);
      stillActiveIds = new Set((existingListings ?? []).map((l) => l.id));
    } else {
      stillActiveIds = new Set((activeListings ?? []).map((l) => l.id));
    }
  }

  const decisions = withCandidates.filter((entry) => !entry.entity_id || stillActiveIds.has(entry.entity_id));

  return NextResponse.json({ decisions });
}
