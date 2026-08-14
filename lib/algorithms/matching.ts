import { haversine } from '@/lib/utils/geo';

export interface MatchBranch {
  id: string;
  name: string;
  lat: number;
  lng: number;
  current_load_kg: number;
  capacity_kg: number;
  color: string;
}

export interface ExistingInventoryItem {
  branch_id: string;
  food_type: string;
  expiry_at: string;
}

export interface MatchWeights {
  proximity: number;
  fairness: number;
  spoilage: number;
}

export interface MatchInput {
  donorLat: number;
  donorLng: number;
  foodType: string;
  branches: MatchBranch[];
  existingInventory: ExistingInventoryItem[];
  weights?: MatchWeights;
}

export interface MatchResult {
  branch: MatchBranch;
  score: number;
  distance_km: number;
  proximity_score: number;
  fairness_need: number;
  spoilage_risk_score: number;
  same_type_expiring_soon: number;
}

export interface ExcludedBranch {
  branch: MatchBranch;
  reason: 'at_capacity';
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = { proximity: 0.3, fairness: 0.5, spoilage: 0.2 };

/**
 * Fairness + Spoilage-Aware Matching
 *
 * Three factors decide which branch receives a donation — this is what the
 * Network Coordinator Agent asks every Branch Coordination Agent to report:
 * 1. Proximity — closer branches reduce travel time and spoilage risk in transit
 * 2. Fairness — branches with more free capacity (relative to their size) are preferred
 * 3. Spoilage risk — branches that ALREADY have a lot of the SAME food type
 *    expiring soon are penalized, to avoid creating a glut that goes to waste
 *
 * Returns every eligible branch's score, sorted best-first, so the full
 * decision can be shown transparently (see /agents).
 */
export function scoreBranches(input: MatchInput): MatchResult[] {
  const { donorLat, donorLng, foodType, branches, existingInventory } = input;
  const weights = input.weights ?? DEFAULT_MATCH_WEIGHTS;
  const now = Date.now();

  const eligible = branches.filter((b) => b.current_load_kg < b.capacity_kg);

  const scored: MatchResult[] = eligible.map((branch) => {
    // Factor 1: Proximity
    const dist = haversine(donorLat, donorLng, branch.lat, branch.lng);
    const proximityScore = 1 / (1 + dist * 10);

    // Factor 2: Fairness (less full = higher need)
    const saturation = branch.capacity_kg > 0 ? branch.current_load_kg / branch.capacity_kg : 1;
    const fairnessScore = 1 - saturation;

    // Factor 3: Spoilage risk — same food type already expiring soon at this branch
    const sameTypeExpiringSoon = existingInventory.filter((item) => {
      if (item.branch_id !== branch.id) return false;
      if (item.food_type !== foodType) return false;
      const hoursLeft = (new Date(item.expiry_at).getTime() - now) / (1000 * 60 * 60);
      return hoursLeft > 0 && hoursLeft <= 24;
    }).length;

    // Normalize: 0 matching items expiring soon = no risk (score 1)
    // 5+ matching items expiring soon = high risk (score approaches 0)
    const spoilageRiskScore = 1 / (1 + sameTypeExpiringSoon * 0.5);

    const totalScore =
      weights.proximity * proximityScore +
      weights.fairness * fairnessScore +
      weights.spoilage * spoilageRiskScore;

    return {
      branch,
      score: totalScore,
      distance_km: dist,
      proximity_score: proximityScore,
      fairness_need: fairnessScore,
      spoilage_risk_score: spoilageRiskScore,
      same_type_expiring_soon: sameTypeExpiringSoon,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function excludedBranches(branches: MatchBranch[]): ExcludedBranch[] {
  return branches
    .filter((b) => b.current_load_kg >= b.capacity_kg)
    .map((branch) => ({ branch, reason: 'at_capacity' as const }));
}

export function findBestBranchMatch(input: MatchInput): MatchResult | null {
  const scored = scoreBranches(input);
  return scored[0] ?? null;
}
