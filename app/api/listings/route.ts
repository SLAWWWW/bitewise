import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase-server';
import { type MatchBranch } from '@/lib/algorithms/matching';
import { runMatchingAgents, DEFAULT_MATCH_WEIGHTS } from '@/lib/agents/run-pipeline';
import { runFoodSafetyCheck } from '@/lib/agents/food-safety-agent';
import { SG_AREAS, DONOR_TYPES } from '@/lib/constants';
import type { Branch, MatchDecisionDetails, SubmitListingResponse } from '@/lib/types';

const AREA_VALUES = SG_AREAS.map((a) => a.value) as [string, ...string[]];

const ListingRequestSchema = z
  .object({
    donor_id: z.string().uuid().optional(),
    donor_name: z.string().min(1).optional(),
    donor_type: z.enum([...DONOR_TYPES]).optional(),
    address: z.string().min(1).optional(),
    area: z.enum(AREA_VALUES).optional(),
    item_name: z.string().min(1),
    food_type: z.enum(['bread', 'cooked', 'produce', 'canned', 'dairy', 'beverage', 'grain', 'other']),
    quantity_kg: z.number().positive(),
    storage_type: z.enum(['ambient', 'cold', 'frozen']).default('ambient'),
    expiry_hours: z.number().positive().max(8760),
    agreed_to_regulations: z.literal(true),
  })
  .refine((data) => !!data.donor_id || !!(data.donor_name && data.donor_type && data.address && data.area), {
    message: 'Provide either donor_id, or donor_name + donor_type + address + area',
  });

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = ListingRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    donor_id,
    donor_name,
    donor_type,
    address,
    area,
    item_name,
    food_type,
    quantity_kg,
    storage_type,
    expiry_hours,
  } = parsed.data;

  // The standardized safety gate (PRD §7.7) runs before anything else —
  // before a donor row is even touched. A 'bad' verdict rejects outright,
  // the only AI-driven decision in this codebase allowed to block a
  // donation rather than just advise on it; 'warning'/'good' proceed to the
  // normal branch-matching pipeline with the verdict carried along for
  // staff to see at approval time.
  const foodSafetyCheck = await runFoodSafetyCheck({
    itemName: item_name,
    foodType: food_type,
    storageType: storage_type,
    quantityKg: quantity_kg,
    expiryHours: expiry_hours,
  });

  if (foodSafetyCheck.verdict === 'bad') {
    const supabase = createServerClient();
    await supabase.from('audit_log').insert({
      actor_type: donor_id ? 'system' : 'public_donor',
      action: 'listing_safety_rejected',
      entity_type: 'food_listing',
      entity_id: null,
      details: { item_name, food_type, storage_type, quantity_kg, expiry_hours, food_safety_check: foodSafetyCheck },
    });
    const response: SubmitListingResponse = {
      success: false,
      message: `This listing can't be accepted: ${foodSafetyCheck.reasoning}`,
      food_safety_check: foodSafetyCheck,
    };
    return NextResponse.json(response, { status: 422 });
  }

  const supabase = createServerClient();

  let resolvedDonorId: string;
  let resolvedDonorLat: number;
  let resolvedDonorLng: number;
  let resolvedDonorName: string;

  if (donor_id) {
    const { data: donor, error: donorError } = await supabase
      .from('donors')
      .select('id, name, lat, lng')
      .eq('id', donor_id)
      .single();
    if (donorError || !donor) {
      return NextResponse.json({ error: 'donor_id not found' }, { status: 404 });
    }
    resolvedDonorId = donor.id;
    resolvedDonorLat = donor.lat;
    resolvedDonorLng = donor.lng;
    resolvedDonorName = donor.name;
  } else {
    const areaInfo = SG_AREAS.find((a) => a.value === area)!;

    const trimmedName = donor_name!.trim();

    const { data: existing } = await supabase
      .from('donors')
      .select('id, name, lat, lng')
      .ilike('name', trimmedName)
      .maybeSingle();

    if (existing) {
      resolvedDonorId = existing.id;
      resolvedDonorLat = existing.lat;
      resolvedDonorLng = existing.lng;
      resolvedDonorName = existing.name;
    } else {
      const { data: created, error: createError } = await supabase
        .from('donors')
        .insert({
          name: trimmedName,
          type: donor_type,
          lat: areaInfo.lat,
          lng: areaInfo.lng,
          address,
          reliability_score: 0.5,
          total_kg_donated: 0,
          status: 'pending',
        })
        .select('id, name, lat, lng')
        .single();

      if (created) {
        resolvedDonorId = created.id;
        resolvedDonorLat = created.lat;
        resolvedDonorLng = created.lng;
        resolvedDonorName = created.name;
      } else if (createError?.code === '23505') {
        // Lost a race against another first-time submission under the same
        // business name (guarded by idx_donors_name_unique_ci). The other
        // request won and its row is the canonical one — adopt it instead of
        // failing the donor's submission.
        const { data: winner, error: reReadError } = await supabase
          .from('donors')
          .select('id, name, lat, lng')
          .ilike('name', trimmedName)
          .maybeSingle();
        if (reReadError || !winner) {
          return NextResponse.json(
            { error: reReadError?.message ?? 'Failed to register donor' },
            { status: 500 }
          );
        }
        resolvedDonorId = winner.id;
        resolvedDonorLat = winner.lat;
        resolvedDonorLng = winner.lng;
        resolvedDonorName = winner.name;
      } else {
        return NextResponse.json(
          { error: createError?.message ?? 'Failed to register donor' },
          { status: 500 }
        );
      }
    }
  }

  const { data: branches, error: branchesError } = await supabase.from('branches').select('*');
  if (branchesError || !branches) {
    return NextResponse.json({ error: branchesError?.message ?? 'Failed to load branches' }, { status: 500 });
  }

  const { data: existingInventory, error: inventoryError } = await supabase
    .from('inventory_items')
    .select('branch_id, food_type, expiry_at')
    .eq('status', 'in_stock');

  if (inventoryError) {
    return NextResponse.json({ error: inventoryError.message }, { status: 500 });
  }

  const matchBranches: MatchBranch[] = (branches as Branch[]).map((b) => ({
    id: b.id,
    name: b.name,
    lat: b.lat,
    lng: b.lng,
    current_load_kg: b.current_load_kg,
    capacity_kg: b.capacity_kg,
    color: b.color,
  }));

  const pipeline = await runMatchingAgents(
    resolvedDonorLat,
    resolvedDonorLng,
    food_type,
    quantity_kg,
    matchBranches,
    existingInventory ?? []
  );

  const chosenCandidate = pipeline.candidates.find((c) => c.branch_id === pipeline.chosenBranchId) ?? null;
  const chosenBranch = matchBranches.find((b) => b.id === pipeline.chosenBranchId) ?? null;

  const decisionDetails: MatchDecisionDetails = {
    donor_name: resolvedDonorName,
    item_name,
    food_type,
    quantity_kg,
    matched_branch_id: chosenBranch?.id ?? null,
    matched_branch: chosenBranch?.name ?? null,
    weights: DEFAULT_MATCH_WEIGHTS,
    candidates: pipeline.candidates,
    excluded_branches: pipeline.excludedBranches,
    coordinator_rationale: pipeline.coordinatorRationale,
    used_ai_agents: pipeline.usedAiAgents,
    food_safety_check: foodSafetyCheck,
  };

  const expiryAt = new Date(Date.now() + expiry_hours * 60 * 60 * 1000).toISOString();

  const { data: listing, error: listingError } = await supabase
    .from('food_listings')
    .insert({
      donor_id: resolvedDonorId,
      matched_branch_id: chosenBranch?.id ?? null,
      item_name,
      food_type,
      quantity_kg,
      storage_type,
      expiry_at: expiryAt,
      status: 'pending',
      matching_score: chosenCandidate?.total_score ?? null,
      spoilage_risk_score: chosenCandidate?.spoilage_risk_score ?? null,
      agreed_to_regulations: true,
      decision_details: decisionDetails,
    })
    .select('id')
    .single();

  if (listingError || !listing) {
    return NextResponse.json({ error: listingError?.message ?? 'Failed to create listing' }, { status: 500 });
  }

  const { error: auditError } = await supabase.from('audit_log').insert({
    actor_type: donor_id ? 'system' : 'public_donor',
    action: 'listing_submitted',
    entity_type: 'food_listing',
    entity_id: listing.id,
    details: decisionDetails,
  });
  if (auditError) {
    // Background write — the listing already exists and is visible to staff.
    // Log loudly so missing audit entries are surfaced in server logs, but
    // don't fail the donor's submission over it.
    console.error(
      `[listings] audit_log insert failed for listing ${listing.id}. ` +
        'The listing was created successfully but will not appear in the decision log. Cause:',
      auditError.message
    );
  }

  const response: SubmitListingResponse = {
    success: true,
    listing_id: listing.id,
    suggested_branch: chosenBranch?.name ?? null,
    suggested_branch_id: chosenBranch?.id ?? null,
    suggested_branch_color: chosenBranch?.color ?? null,
    suggested_branch_lat: chosenBranch?.lat ?? null,
    suggested_branch_lng: chosenBranch?.lng ?? null,
    score: chosenCandidate?.total_score ?? null,
    distance_km: chosenCandidate?.distance_km ?? null,
    spoilage_risk_score: chosenCandidate?.spoilage_risk_score ?? null,
    food_safety_check: foodSafetyCheck,
  };

  if (!chosenBranch) {
    response.message =
      pipeline.coordinatorRationale ||
      'All Willing Hearts branches are currently at capacity — a staff member will need to review this manually.';
  }

  return NextResponse.json(response);
}
