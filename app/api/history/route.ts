import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import type { MatchDecisionDetails } from '@/lib/types';

const WINDOW_HOURS = 24;

/**
 * Completed donations from the last 24 hours — the one place a finished
 * donation's story lives once it's done. Everything else (Agent Decisions,
 * the Command Center feed, Storage, Dispatch) only shows active work now;
 * a donation drops out of all of them and appears here instead the moment
 * a completion route (pickup / confirm-delivery / confirm-recycle) stamps
 * `food_listings.delivered_at`. Nothing is deleted to make this happen —
 * `food_listings` rows persist forever — this is just a time-windowed read,
 * so "resets every 24h" falls out naturally: entries simply age out of the
 * `.gte('delivered_at', ...)` filter, nothing has to actively clear them.
 */
export async function GET() {
  const supabase = createServerClient();
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();

  const { data, error } = await supabase
    .from('food_listings')
    .select('id, item_name, quantity_kg, food_type, decision_details, delivered_at, completed_via')
    .not('delivered_at', 'is', null)
    .gte('delivered_at', cutoff)
    .order('delivered_at', { ascending: false })
    .limit(50);

  if (error) {
    // Missing migration 013 (no delivered_at/completed_via columns yet) —
    // degrade to an empty history rather than a broken Network Overview.
    console.error('[history] query failed — likely migration 013 not applied yet:', error.message);
    return NextResponse.json({ entries: [] });
  }

  const entries = (data ?? []).map((row) => {
    const details = row.decision_details as MatchDecisionDetails | null;
    return {
      id: row.id,
      item_name: row.item_name,
      quantity_kg: row.quantity_kg,
      food_type: row.food_type,
      donor_name: details?.donor_name ?? null,
      branch_name: details?.matched_branch?.replace('Willing Hearts — ', '') ?? null,
      completed_via: row.completed_via as 'public_pickup' | 'partner_delivery' | 'recycled' | null,
      delivered_at: row.delivered_at as string,
    };
  });

  return NextResponse.json({ entries, window_hours: WINDOW_HOURS });
}
