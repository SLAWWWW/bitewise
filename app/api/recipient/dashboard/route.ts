import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase-server';

const QuerySchema = z.object({ profile_id: z.string().uuid() });

/**
 * A recipient's own impact dashboard: lifetime totals (kg claimed, meals
 * equivalent, CO₂ avoided, a sustainability score) plus their currently
 * active reservations — including, for transparency, the same Supply Chain
 * Planner Agent output staff see, so a claim isn't a black box.
 *
 * Lifetime totals are a running total on recipient_profiles (§011), not a
 * sum over claims — confirmed pickups delete their inventory_items row, so
 * summing at read time would silently lose everything already collected.
 *
 * Same conversion factors used everywhere else in this app (donor impact,
 * Donor Impact Agent) — 1kg ≈ 2 meals, 1kg ≈ 2.5kg CO₂ avoided — so the
 * numbers agree no matter which side of the platform you're looking from.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({ profile_id: searchParams.get('profile_id') });
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: 'A valid profile_id is required.' }, { status: 400 });
  }
  const { profile_id } = parsed.data;

  const supabase = createServerClient();

  let { data: profile, error: profileError } = await supabase
    .from('recipient_profiles')
    .select('id, name, total_kg_claimed, donations_completed_count')
    .eq('id', profile_id)
    .maybeSingle();

  if (profileError) {
    // Missing migration 011 (no total_kg_claimed/donations_completed_count
    // columns yet) fails the whole select, not just those two fields —
    // retry without them so a real profile still renders (with zeroed
    // lifetime totals) instead of the dashboard reporting "not found" for
    // someone who very much has a profile.
    console.error('[recipient/dashboard] profile query failed — retrying without impact columns (likely migration 011 not applied):', profileError.message);
    const retry = await supabase.from('recipient_profiles').select('id, name').eq('id', profile_id).maybeSingle();
    profile = retry.data ? { ...retry.data, total_kg_claimed: 0, donations_completed_count: 0 } : null;
    profileError = retry.error;
  }

  if (!profile) {
    return NextResponse.json({ success: false, message: 'Profile not found.' }, { status: 404 });
  }

  const totalKg = profile?.total_kg_claimed ?? 0;
  const donationsCompleted = profile?.donations_completed_count ?? 0;

  const { data: activeRows, error: claimsError } = await supabase
    .from('claims')
    .select(
      `id, status, claimed_at, pickup_deadline_at,
       inventory_item:inventory_items(
         id, item_name, food_type, quantity, unit, listing_id, expiry_at,
         branch:branches(name, area),
         listing:food_listings(decision_details)
       )`
    )
    .eq('profile_id', profile_id)
    .eq('status', 'claimed')
    .order('claimed_at', { ascending: false });

  if (claimsError) {
    console.error('[recipient/dashboard] active claims query failed:', claimsError.message);
  }

  type ActiveRow = {
    id: string;
    status: string;
    claimed_at: string;
    pickup_deadline_at: string | null;
    inventory_item: {
      id: string;
      item_name: string;
      food_type: string;
      quantity: number;
      unit: string;
      listing_id: string | null;
      expiry_at: string;
      branch: { name: string; area: string | null } | null;
      listing: { decision_details: { supply_chain_plan?: unknown } | null } | null;
    } | null;
  };

  const activeClaims = ((activeRows as ActiveRow[] | null) ?? [])
    .filter((row) => row.inventory_item !== null)
    .map((row) => ({
      claim_id: row.id,
      claimed_at: row.claimed_at,
      pickup_deadline_at: row.pickup_deadline_at,
      item_name: row.inventory_item!.item_name,
      food_type: row.inventory_item!.food_type,
      quantity: row.inventory_item!.quantity,
      unit: row.inventory_item!.unit,
      expiry_at: row.inventory_item!.expiry_at,
      branch_name: row.inventory_item!.branch?.name?.replace('Willing Hearts — ', '') ?? null,
      branch_area: row.inventory_item!.branch?.area ?? null,
      listing_id: row.inventory_item!.listing_id,
      supply_chain_plan: row.inventory_item!.listing?.decision_details?.supply_chain_plan ?? null,
    }));

  return NextResponse.json({
    success: true,
    profile: profile
      ? {
          id: profile.id,
          name: profile.name,
          total_kg_claimed: totalKg,
          donations_completed_count: donationsCompleted,
          meals_equivalent: Math.round(totalKg * 2),
          co2_avoided_kg: Number((totalKg * 2.5).toFixed(1)),
          // Every kilogram rescued counts toward the score, capped at 100 so
          // it stays a legible "how far along are you" read rather than an
          // unbounded number — the formula itself is shown on the dashboard,
          // same transparency standard as every other computed score in
          // this app (Jain's Fairness Index, food-safety scores, etc).
          sustainability_score: Math.min(100, Math.round(totalKg * 1.5)),
        }
      : null,
    active_claims: activeClaims,
  });
}
