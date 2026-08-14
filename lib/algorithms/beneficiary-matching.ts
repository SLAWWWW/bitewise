import type { PartnerBeneficiary } from '@/lib/data/beneficiaries';

export interface BeneficiaryMatchInput {
  candidates: PartnerBeneficiary[];
  foodType: string;
  needsColdChain: boolean;
  /** Today's already-allocated kg per beneficiary key (from `beneficiary_allocations`). */
  fulfilledTodayByKey: Map<string, number>;
}

export interface BeneficiaryMatchResult {
  beneficiary: PartnerBeneficiary;
  fulfilled_today_kg: number;
  need_score: number;
  proximity_score: number;
  total_score: number;
}

/** Cooked food needs a partner that can plate it; cold-chain items need one
 *  that can actually keep them cold. Same compatibility check `/api/dispatch`
 *  already used, just factored out so both places agree on what "eligible"
 *  means. */
export function beneficiaryAccepts(
  partner: PartnerBeneficiary,
  foodType: string,
  needsColdChain: boolean
): boolean {
  if (needsColdChain && !partner.accepts.needs_cold_chain) return false;
  if (foodType === 'cooked' && !partner.accepts.cooked) return false;
  return true;
}

/**
 * Demand-quota allocation — the real-world mechanic behind both Willing
 * Hearts (kitchen → drop-off points by registered quota) and Food Bank
 * Singapore (warehouse → partner beneficiaries by registered quota): a
 * donation should go to whichever eligible partner has the most UNMET need
 * relative to what they actually asked for, not just whoever's closest.
 *
 * Two factors, need weighted well above proximity — closeness is a tie-
 * breaker here, fairness is the point:
 * 1. Need — how far below today's quota this partner still is (1 = nothing
 *    filled yet, 0 = already at or over quota)
 * 2. Proximity — shorter contingency legs are still preferred among partners
 *    with similar need
 */
export function scoreBeneficiaries(input: BeneficiaryMatchInput): BeneficiaryMatchResult[] {
  const { candidates, foodType, needsColdChain, fulfilledTodayByKey } = input;

  const eligible = candidates.filter((b) => beneficiaryAccepts(b, foodType, needsColdChain));

  const scored: BeneficiaryMatchResult[] = eligible.map((beneficiary) => {
    const fulfilled = fulfilledTodayByKey.get(beneficiary.key) ?? 0;
    const quotaRatio = beneficiary.daily_quota_kg > 0 ? fulfilled / beneficiary.daily_quota_kg : 1;
    const needScore = Math.max(0, Math.min(1, 1 - quotaRatio));

    const proximityScore = 1 / (1 + beneficiary.minutes_from_branch / 10);

    const totalScore = 0.65 * needScore + 0.35 * proximityScore;

    return {
      beneficiary,
      fulfilled_today_kg: fulfilled,
      need_score: needScore,
      proximity_score: proximityScore,
      total_score: totalScore,
    };
  });

  scored.sort((a, b) => b.total_score - a.total_score);
  return scored;
}

/** The single best partner for this donation, or null if every eligible
 *  partner nearby is already at or over their daily quota — in which case
 *  the donation falls through to public listing instead (the secondary
 *  channel, not the primary one). */
export function findBestBeneficiaryMatch(input: BeneficiaryMatchInput): BeneficiaryMatchResult | null {
  const scored = scoreBeneficiaries(input);
  const best = scored[0];
  return best && best.need_score > 0 ? best : null;
}
