import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase-server';
import { computePickupWindow } from '@/lib/agents/pickup-window-agent';
import { isRateLimited, clientKey } from '@/lib/rate-limit';
import type { MatchDecisionDetails } from '@/lib/types';

const ClaimRequestSchema = z.object({
  inventory_item_id: z.string().uuid(),
  profile_id: z.string().uuid(),
});

export async function POST(request: Request) {
  // One Gemini call per claim (pickup-window computation) — same shared
  // free-tier quota concern as /api/listings and /api/food-safety/check.
  if (isRateLimited(`claims:${clientKey(request)}`, 12)) {
    return NextResponse.json({ error: 'Too many claims — please wait a minute and try again.' }, { status: 429 });
  }

  const body = await request.json();
  const parsed = ClaimRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { inventory_item_id, profile_id } = parsed.data;
  const supabase = createServerClient();

  // One active reservation per recipient — checked before touching the item,
  // so a recipient sitting on an unclaimed reservation can't hold a second
  // one hostage too. 'claimed' is the only status that counts as active;
  // 'picked_up' and 'no_show' have already released their slot.
  const { data: activeClaims, error: activeError } = await supabase
    .from('claims')
    .select('id, inventory_item_id')
    .eq('profile_id', profile_id)
    .eq('status', 'claimed');

  if (activeError) {
    console.error(
      '[claims] active-claim check failed. If this mentions "profile_id", run ' +
        'supabase/migrations/009_recipient_profiles.sql. Cause:',
      activeError.message
    );
  } else if (activeClaims && activeClaims.length > 0) {
    return NextResponse.json(
      {
        success: false,
        reason: 'active_claim_exists',
        message: 'You already have an active reservation — collect it (or let it release) before claiming another.',
      },
      { status: 409 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from('inventory_items')
    .update({ status: 'reserved' })
    .eq('id', inventory_item_id)
    .eq('status', 'in_stock')
    .select('id, expiry_at, food_type, storage_type, listing_id')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      { success: false, message: 'This item was just claimed by someone else.' },
      { status: 409 }
    );
  }

  // Pickup window is always agent-computed (§7.8), never a fixed constant —
  // the deterministic tier formula runs unconditionally, Gemini only refines
  // it within a bounded range. Best-effort: a plan lookup failure still
  // leaves a valid deterministic window, never blocks the reservation itself.
  let cachedPlan = null;
  if (updated.listing_id) {
    const { data: listing } = await supabase
      .from('food_listings')
      .select('decision_details')
      .eq('id', updated.listing_id)
      .maybeSingle();
    cachedPlan = (listing?.decision_details as MatchDecisionDetails | null)?.supply_chain_plan ?? null;
  }

  const hoursRemaining = Math.max(0.01, (new Date(updated.expiry_at).getTime() - Date.now()) / 3_600_000);
  const window = await computePickupWindow({
    hoursRemaining,
    foodType: updated.food_type,
    storageType: updated.storage_type,
    cachedPlan,
  });
  const pickupDeadlineAt = new Date(Date.now() + window.minutes * 60_000).toISOString();

  const { error: claimError } = await supabase.from('claims').insert({
    inventory_item_id,
    profile_id,
    status: 'claimed',
    pickup_deadline_at: pickupDeadlineAt,
  });

  // Tracks whether profile_id/pickup_deadline_at actually landed in the row —
  // the response must never promise a countdown that isn't really stored,
  // since nothing would ever sweep a deadline that only exists in this
  // response object and not in the database.
  let deadlinePersisted = true;

  if (claimError) {
    console.error(
      '[claims] insert failed. If this mentions "profile_id" or "pickup_deadline_at", run ' +
        'supabase/migrations/009_recipient_profiles.sql. Cause:',
      claimError.message
    );
    // The inventory item is already reserved — retry without the new columns
    // rather than leaving it reserved with no claims row at all.
    deadlinePersisted = false;
    const { error: fallbackError } = await supabase.from('claims').insert({ inventory_item_id, status: 'claimed' });
    if (fallbackError) {
      return NextResponse.json({ error: fallbackError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    pickup_deadline_at: deadlinePersisted ? pickupDeadlineAt : undefined,
    pickup_window_minutes: deadlinePersisted ? window.minutes : undefined,
    pickup_window_rationale: deadlinePersisted ? window.rationale : undefined,
  });
}
