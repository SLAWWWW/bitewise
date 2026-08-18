import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { calculateJainFairnessIndex } from '@/lib/algorithms/jain-fairness';
import { scoreBranches, type MatchBranch } from '@/lib/algorithms/matching';
import { findBestBeneficiaryMatch } from '@/lib/algorithms/beneficiary-matching';
import { beneficiariesForArea } from '@/lib/data/beneficiaries';
import { runMatchingAgents, DEFAULT_MATCH_WEIGHTS, type AgentPipelineResult } from '@/lib/agents/run-pipeline';
import { rankDispatchCandidates, isOpenRun, type FleetRunRow, type VehicleRow } from '@/lib/fleet';
import { runDispatchSweep } from '@/lib/dispatch-planning';
import type { ApprovalActionResponse, Branch, BeneficiaryAllocationDetails, MatchDecisionDetails } from '@/lib/types';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: listing, error: listingFetchError } = await supabase
    .from('food_listings')
    .select('*')
    .eq('id', id)
    .single();

  if (listingFetchError || !listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }
  if (listing.status !== 'pending') {
    const response: ApprovalActionResponse = { success: false, message: 'This listing was already reviewed.' };
    return NextResponse.json(response, { status: 409 });
  }
  if (!listing.donor_id) {
    return NextResponse.json({ error: 'Listing has no donor on record' }, { status: 500 });
  }

  const { data: donor, error: donorError } = await supabase
    .from('donors')
    .select('*')
    .eq('id', listing.donor_id)
    .single();
  if (donorError || !donor) {
    return NextResponse.json({ error: 'Donor not found' }, { status: 500 });
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

  // Re-verify against current state rather than blindly trusting the
  // submission-time decision — other approvals may have shifted branch loads
  // since then. But only pay for a fresh (Gemini-backed) pipeline run when
  // something the previous decision actually depended on has changed: the
  // coordinator agent is allowed to deviate from the raw top score (that's
  // the point of it being a real decision-maker), so comparing against "is
  // this still the deterministic #1 pick" would force a re-run — and burn
  // another 4 calls against the free tier's 15-per-minute quota — every time
  // it made an interesting choice. Instead, recompute the three inputs for
  // the SPECIFIC branch that was already chosen; if they're unchanged (and
  // it's still eligible), nothing the original decision relied on is stale.
  const storedDecision = listing.decision_details as MatchDecisionDetails | null;
  const preScored = scoreBranches({
    donorLat: donor.lat,
    donorLng: donor.lng,
    foodType: listing.food_type,
    branches: matchBranches,
    existingInventory: existingInventory ?? [],
  });
  const storedMatchedId = storedDecision?.matched_branch_id ?? null;
  const storedCandidate = storedDecision?.candidates.find((c) => c.branch_id === storedMatchedId) ?? null;
  const currentScoreForStoredBranch = preScored.find((s) => s.branch.id === storedMatchedId) ?? null;
  const EPS = 0.0005;
  const canReuseStoredDecision =
    !!storedCandidate &&
    !!currentScoreForStoredBranch &&
    Math.abs(currentScoreForStoredBranch.proximity_score - storedCandidate.proximity_score) < EPS &&
    Math.abs(currentScoreForStoredBranch.fairness_need - storedCandidate.fairness_score) < EPS &&
    Math.abs(currentScoreForStoredBranch.spoilage_risk_score - storedCandidate.spoilage_risk_score) < EPS;

  const pipeline: AgentPipelineResult = canReuseStoredDecision
    ? {
        candidates: storedDecision!.candidates,
        excludedBranches: storedDecision!.excluded_branches,
        chosenBranchId: storedDecision!.matched_branch_id,
        coordinatorRationale: storedDecision!.coordinator_rationale ?? '',
        usedAiAgents: storedDecision!.used_ai_agents ?? false,
      }
    : await runMatchingAgents(
        donor.lat,
        donor.lng,
        listing.food_type,
        listing.quantity_kg,
        matchBranches,
        existingInventory ?? []
      );

  const chosenCandidate = pipeline.candidates.find((c) => c.branch_id === pipeline.chosenBranchId) ?? null;
  const matched = matchBranches.find((b) => b.id === pipeline.chosenBranchId) ?? null;

  if (!matched || !chosenCandidate) {
    const response: ApprovalActionResponse = {
      success: false,
      message: pipeline.coordinatorRationale || 'No branch currently has capacity for this donation — cannot approve yet.',
    };
    return NextResponse.json(response, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const needsColdChain = listing.storage_type === 'cold' || listing.storage_type === 'frozen';

  // Demand-quota allocation is the PRIMARY channel now, not a 3-hour-unclaimed
  // fallback: real Willing Hearts and Food Bank Singapore both route donated
  // food to registered partners by their declared daily quota before it ever
  // reaches an anonymous public listing (see lib/algorithms/beneficiary-matching.ts).
  // Best-effort by design — a missing migration 008 or any query failure here
  // must never block the approval itself; it just falls through to public
  // listing, exactly like today.
  let beneficiaryAllocation: BeneficiaryAllocationDetails | null = null;
  try {
    const matchedBranchFull = (branches as Branch[]).find((b) => b.id === matched.id) ?? null;
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { data: allocRows, error: allocError } = await supabase
      .from('beneficiary_allocations')
      .select('beneficiary_key, quantity_kg')
      .gte('allocated_at', todayStart.toISOString());

    if (allocError) {
      // Unknown-today is NOT the same as unallocated-today: without this table
      // every partner would look 100% free of quota and this would silently
      // route ALL approvals to a beneficiary instead of just falling back to
      // the pre-existing public-listing behavior. Skip the feature entirely
      // until the migration is applied rather than matching on fabricated data.
      console.error(
        '[approve] beneficiary_allocations query failed — skipping demand-quota allocation for this approval. ' +
          'If this mentions "beneficiary_allocations", run supabase/migrations/008_beneficiary_allocations.sql. Cause:',
        allocError.message
      );
    } else {
      const fulfilledTodayByKey = new Map<string, number>();
      for (const row of allocRows ?? []) {
        fulfilledTodayByKey.set(
          row.beneficiary_key,
          (fulfilledTodayByKey.get(row.beneficiary_key) ?? 0) + row.quantity_kg
        );
      }

      const best = findBestBeneficiaryMatch({
        candidates: beneficiariesForArea(matchedBranchFull?.area ?? null),
        foodType: listing.food_type,
        needsColdChain,
        fulfilledTodayByKey,
      });

      if (best) {
        beneficiaryAllocation = {
          beneficiary_key: best.beneficiary.key,
          beneficiary_name: best.beneficiary.name,
          beneficiary_type: best.beneficiary.type,
          daily_quota_kg: best.beneficiary.daily_quota_kg,
          fulfilled_before_kg: best.fulfilled_today_kg,
          need_score: Number(best.need_score.toFixed(3)),
          proximity_score: Number(best.proximity_score.toFixed(3)),
        };
      }
    }
  } catch (err) {
    console.error('[approve] beneficiary allocation check threw unexpectedly — falling back to public listing:', err);
  }

  const decisionDetails: MatchDecisionDetails = {
    donor_name: donor.name,
    item_name: listing.item_name,
    food_type: listing.food_type,
    quantity_kg: listing.quantity_kg,
    matched_branch_id: matched.id,
    matched_branch: matched.name,
    weights: DEFAULT_MATCH_WEIGHTS,
    candidates: pipeline.candidates,
    excluded_branches: pipeline.excludedBranches,
    coordinator_rationale: pipeline.coordinatorRationale,
    used_ai_agents: pipeline.usedAiAgents,
    beneficiary_allocation: beneficiaryAllocation ?? undefined,
    // Computed once at submission time (§7.7) — carried forward rather than
    // recomputed, since this reconstruction of decision_details would
    // otherwise silently drop it on every approval.
    food_safety_check: storedDecision?.food_safety_check,
  };

  // Claim the listing FIRST, before touching branches/inventory/donor. Two
  // concurrent approve requests (double-click, or two staff acting at once)
  // both pass the read check above before either commits — this guarded
  // write is what actually decides a winner. The loser sees 0 rows updated
  // and backs out here, before it has made any other write — no revert
  // logic needed, and no duplicate inventory_items row gets created.
  const { data: claimedRows, error: claimError } = await supabase
    .from('food_listings')
    .update({
      status: 'matched',
      matched_branch_id: matched.id,
      matching_score: chosenCandidate.total_score,
      spoilage_risk_score: chosenCandidate.spoilage_risk_score,
      matched_at: nowIso,
      reviewed_at: nowIso,
      decision_details: decisionDetails,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }
  if (!claimedRows || claimedRows.length === 0) {
    const response: ApprovalActionResponse = { success: false, message: 'This listing was already reviewed.' };
    return NextResponse.json(response, { status: 409 });
  }

  // Only the winner reaches here. current_load_kg is incremented atomically
  // in the database (a single UPDATE ... SET x = x + amount statement) so a
  // *different* listing being approved onto the same branch at the same
  // moment can't cause a lost update either.
  const { error: incrementError } = await supabase.rpc('increment_branch_load', {
    p_branch_id: matched.id,
    p_amount: listing.quantity_kg,
  });
  if (incrementError) {
    // We already claimed the listing above — if we stopped here it would be
    // stuck as 'matched' with no inventory and no audit entry, silently
    // vanished from the approvals queue with nothing to show for it. Put it
    // back rather than losing it.
    await supabase
      .from('food_listings')
      .update({
        status: 'pending',
        matched_branch_id: null,
        matching_score: null,
        spoilage_risk_score: null,
        matched_at: null,
        reviewed_at: null,
      })
      .eq('id', id);
    return NextResponse.json({ error: incrementError.message }, { status: 500 });
  }

  // A beneficiary allocation means this item goes straight to a partner
  // instead of the public shelf — reuses the existing 'escalated' status
  // rather than adding a new one, since it means the same thing downstream
  // (routed to a partner, not publicly claimable), just reached earlier and
  // deliberately instead of reactively after 3 hours unclaimed.
  const inventoryStatus = beneficiaryAllocation ? 'escalated' : 'in_stock';

  // listing_id carries provenance: it's what lets the item be traced back to
  // the donation and donor, and joined to the fleet run collecting it so the
  // public list can show whether the food has actually arrived yet.
  const { data: insertedInventory, error: inventoryInsertError } = await supabase
    .from('inventory_items')
    .insert({
      branch_id: matched.id,
      listing_id: id,
      item_name: listing.item_name,
      food_type: listing.food_type,
      quantity: listing.quantity_kg,
      unit: 'kg',
      storage_type: listing.storage_type,
      expiry_at: listing.expiry_at,
      status: inventoryStatus,
    })
    .select('id')
    .single();

  let inventoryItemId: string | null = insertedInventory?.id ?? null;

  if (inventoryInsertError) {
    // Most likely 007_inventory_provenance.sql hasn't been run, so listing_id
    // doesn't exist as a column. Retry without it rather than losing the
    // inventory row — the item still lands at the branch, it just can't show
    // delivery progress until the migration is applied.
    console.error(
      '[approve] inventory insert failed; retrying without provenance link. ' +
        'If this mentions "listing_id", run supabase/migrations/007_inventory_provenance.sql. Cause:',
      inventoryInsertError.message
    );
    const { data: fallbackInventory, error: fallbackInsertError } = await supabase
      .from('inventory_items')
      .insert({
        branch_id: matched.id,
        item_name: listing.item_name,
        food_type: listing.food_type,
        quantity: listing.quantity_kg,
        unit: 'kg',
        storage_type: listing.storage_type,
        expiry_at: listing.expiry_at,
        status: inventoryStatus,
      })
      .select('id')
      .single();
    if (fallbackInsertError) {
      // Both the provenance-linked insert and its fallback failed. Branch load
      // has already been incremented and the listing is matched — partial state.
      // Surface this immediately: the item will not appear in public inventory
      // and staff cannot see it on the storage page until it is manually inserted.
      console.error(
        `[approve] fallback inventory insert also failed for listing ${id}. ` +
          'The branch load was incremented but NO inventory row was created. ' +
          'Insert it manually into inventory_items. Cause:',
        fallbackInsertError.message
      );
    } else {
      inventoryItemId = fallbackInventory?.id ?? null;
    }
  }

  // Record the allocation so tomorrow's (and later today's) quota check knows
  // this partner already received some of today's supply. Best-effort: the
  // donation is already committed either way, this is only for fairness
  // bookkeeping — a failure here must not undo or fail the approval.
  if (beneficiaryAllocation) {
    const { error: allocInsertError } = await supabase.from('beneficiary_allocations').insert({
      beneficiary_key: beneficiaryAllocation.beneficiary_key,
      beneficiary_name: beneficiaryAllocation.beneficiary_name,
      inventory_item_id: inventoryItemId,
      quantity_kg: listing.quantity_kg,
    });
    if (allocInsertError) {
      console.error(
        `[approve] beneficiary_allocations insert failed for listing ${id} — ` +
          `${beneficiaryAllocation.beneficiary_name}'s quota fulfilment today will undercount. ` +
          'If this mentions "beneficiary_allocations", run supabase/migrations/008_beneficiary_allocations.sql. Cause:',
        allocInsertError.message
      );
    }

    // This item just landed in inventory as 'escalated' — it was never going
    // to be publicly listed, so there's no reason to make it wait for a
    // batch. Dispatch immediately if the branch doesn't already have a run
    // in flight. Awaited (not fire-and-forget): a serverless function can be
    // torn down the moment it returns, so an un-awaited sweep here could
    // simply never run. Best-effort regardless — the approval itself already
    // succeeded, a sweep failure here must not undo it.
    try {
      await runDispatchSweep(supabase);
    } catch (err) {
      console.error(`[approve] immediate dispatch sweep failed for listing ${id}:`, err);
    }
  }

  const { error: donorTotalError } = await supabase.rpc('increment_donor_total', {
    p_donor_id: donor.id,
    p_amount: Math.round(listing.quantity_kg),
  });
  if (donorTotalError) {
    // Background ledger update — the listing is already matched and the branch
    // load already incremented. Don't roll back over a soft metric, but surface
    // it so the donor leaderboard is known to be stale.
    console.error(
      `[approve] increment_donor_total failed for donor ${donor.id} on listing ${id}. ` +
        'The listing was approved successfully but the donor total will be incorrect until fixed. Cause:',
      donorTotalError.message
    );
  }
  if (donor.status === 'pending') {
    const { error: donorStatusError } = await supabase
      .from('donors')
      .update({ status: 'verified' })
      .eq('id', donor.id);
    if (donorStatusError) {
      console.error(
        `[approve] donors status update to 'verified' failed for donor ${donor.id}. ` +
          'The listing was approved but the donor will remain in pending state. Cause:',
        donorStatusError.message
      );
    }
  }

  // Re-fetch branches fresh for the fairness snapshot — other approvals may
  // have landed on other branches since we first read them above, and this
  // branch's load was just updated atomically in the database, not in JS.
  const { data: freshBranches } = await supabase.from('branches').select('current_load_kg, capacity_kg, id');
  const jainIndex = calculateJainFairnessIndex(freshBranches ?? matchBranches);
  const branchRatios = Object.fromEntries(
    (freshBranches ?? []).map((b) => [b.id, b.capacity_kg > 0 ? b.current_load_kg / b.capacity_kg : 0])
  );

  const { data: allListings } = await supabase.from('food_listings').select('quantity_kg, status');
  const totalRescuedKg = (allListings ?? [])
    .filter((l) => l.status === 'matched' || l.status === 'in_transit' || l.status === 'delivered')
    .reduce((sum, l) => sum + (l.quantity_kg ?? 0), 0);

  const { error: snapshotError } = await supabase.from('fairness_snapshots').insert({
    jain_index: jainIndex,
    branch_ratios: branchRatios,
    total_food_rescued_kg: totalRescuedKg,
  });
  if (snapshotError) {
    console.error(
      `[approve] fairness_snapshots insert failed after listing ${id} was approved. ` +
        'The jain_index time-series will have a gap at this approval event. Cause:',
      snapshotError.message
    );
  }

  const { error: approveAuditError } = await supabase.from('audit_log').insert({
    actor_type: 'ngo_staff',
    action: 'match_approved',
    entity_type: 'food_listing',
    entity_id: id,
    details: decisionDetails,
  });
  if (approveAuditError) {
    console.error(
      `[approve] audit_log 'match_approved' insert failed for listing ${id}. ` +
        'The listing was approved but this action will not appear in the audit trail. Cause:',
      approveAuditError.message
    );
  }

  // Put a vehicle on the collection. Best-effort by design: the donation is
  // already committed at this point, and a fleet problem must not undo that or
  // fail the request. If nothing can be assigned we report why so the UI can
  // tell staff to sort it out on the Logistics page.
  const dispatch = await assignVehicleForListing(supabase, {
    listingId: id,
    servingBranchId: matched.id,
    quantityKg: listing.quantity_kg,
    needsColdChain,
    branches: branches as Branch[],
  });

  const response: ApprovalActionResponse = {
    success: true,
    matched_branch: matched.name,
    jain_index: Number(jainIndex.toFixed(4)),
    dispatch,
  };
  return NextResponse.json(response);
}

/**
 * Reserves the best available vehicle for a freshly approved collection.
 *
 * Own-branch vehicles are preferred; if none is free, the nearest vehicle from
 * another branch is taken and flagged as a cross-branch borrow so staff can see
 * that a branch has given up its own coverage.
 *
 * Insertion races are handled by the database, not by checking first: a partial
 * unique index allows only one open run per vehicle, so if two approvals grab
 * the same van simultaneously one insert fails and we simply try the next
 * candidate.
 */
async function assignVehicleForListing(
  supabase: ReturnType<typeof createServerClient>,
  params: {
    listingId: string;
    servingBranchId: string;
    quantityKg: number;
    needsColdChain: boolean;
    branches: Branch[];
  }
): Promise<ApprovalActionResponse['dispatch']> {
  const { listingId, servingBranchId, quantityKg, needsColdChain, branches } = params;

  const [vehiclesRes, runsRes] = await Promise.all([
    supabase.from('vehicles').select('*'),
    supabase.from('fleet_runs').select('*'),
  ]);

  if (vehiclesRes.error || runsRes.error) {
    return {
      assigned: false,
      reason: 'Fleet tracking is not set up yet — run migration 006 to enable vehicle assignment.',
    };
  }

  const candidates = rankDispatchCandidates({
    vehicles: (vehiclesRes.data ?? []) as VehicleRow[],
    openRuns: ((runsRes.data ?? []) as FleetRunRow[]).filter((r) => isOpenRun(r.status)),
    branches: branches.map((b) => ({ id: b.id, name: b.name, lat: b.lat, lng: b.lng })),
    servingBranchId,
    quantityKg,
    needsColdChain,
  });

  if (candidates.length === 0) {
    return {
      assigned: false,
      reason: needsColdChain
        ? 'No refrigerated vehicle is free anywhere in the network — assign one manually once a run completes.'
        : 'No vehicle with enough capacity is free — assign one manually on the Logistics page.',
    };
  }

  for (const candidate of candidates) {
    const { error } = await supabase.from('fleet_runs').insert({
      vehicle_id: candidate.vehicle.id,
      listing_id: listingId,
      serving_branch_id: servingBranchId,
      status: 'assigned',
      quantity_kg: quantityKg,
    });

    if (!error) {
      return {
        assigned: true,
        vehicle_label: candidate.vehicle.label,
        vehicle_type: candidate.vehicle.type,
        driver_name: candidate.vehicle.driver_name,
        is_cross_branch: candidate.is_cross_branch,
        home_branch_name: candidate.home_branch_name,
        transfer_km: candidate.is_cross_branch ? candidate.distance_km : undefined,
      };
    }

    // 23505 = another approval claimed this vehicle first; try the next one.
    if (error.code !== '23505') {
      console.error('fleet run insert failed:', error.message);
      return { assigned: false, reason: 'Could not record the vehicle assignment.' };
    }
  }

  return {
    assigned: false,
    reason: 'Every candidate vehicle was taken by another dispatch — assign one manually.',
  };
}
