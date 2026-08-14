import { GoogleGenAI } from '@google/genai';
import { scoreBranches, excludedBranches, DEFAULT_MATCH_WEIGHTS, type MatchBranch } from '@/lib/algorithms/matching';
import { runBranchAgent, type BranchAgentReport } from './branch-agent';
import { runCoordinatorAgent } from './coordinator-agent';
import type { CandidateScore, ExcludedBranchInfo } from '@/lib/types';

/** Gemini's free tier caps generateContent at 15 requests/minute per model.
 *  Consulting every eligible branch plus the coordinator can cost more calls
 *  than that in a single decision, so only the top-scoring branches (by the
 *  free deterministic formula) get a real agent — the rest are shortlisted
 *  out before any API quota is spent on them. */
const SHORTLIST_SIZE = 3;

export interface AgentPipelineResult {
  candidates: CandidateScore[];
  excludedBranches: ExcludedBranchInfo[];
  chosenBranchId: string | null;
  coordinatorRationale: string;
  usedAiAgents: boolean;
}

function toExcludedInfo(branches: MatchBranch[]): ExcludedBranchInfo[] {
  return excludedBranches(branches).map((e) => ({
    branch_id: e.branch.id,
    branch_name: e.branch.name,
    branch_color: e.branch.color,
    reason: `At capacity (${e.branch.current_load_kg}/${e.branch.capacity_kg}kg) — no room for this donation.`,
    current_load_kg: e.branch.current_load_kg,
    capacity_kg: e.branch.capacity_kg,
  }));
}

function reportsToCandidates(reports: BranchAgentReport[]): CandidateScore[] {
  return [...reports]
    .sort((a, b) => b.total_score - a.total_score)
    .map((r) => ({
      branch_id: r.branch_id,
      branch_name: r.branch_name,
      branch_color: r.branch_color,
      distance_km: Number(r.distance_km.toFixed(2)),
      proximity_score: Number(r.proximity_score.toFixed(3)),
      fairness_score: Number(r.fairness_score.toFixed(3)),
      spoilage_risk_score: Number(r.spoilage_risk_score.toFixed(3)),
      same_type_expiring_soon: r.same_type_expiring_soon,
      total_score: Number(r.total_score.toFixed(3)),
      rationale: r.rationale,
      tool_calls: r.tool_calls,
    }));
}

/** Deterministic-only path — no AI agents at all. Used when GEMINI_API_KEY
 *  isn't set, and as the last-resort fallback if the agent pipeline throws. */
function runDeterministic(
  donorLat: number,
  donorLng: number,
  foodType: string,
  branches: MatchBranch[],
  existingInventory: { branch_id: string; food_type: string; expiry_at: string }[],
  reason: string
): AgentPipelineResult {
  const scored = scoreBranches({ donorLat, donorLng, foodType, branches, existingInventory });
  const candidates: CandidateScore[] = scored.map((s) => ({
    branch_id: s.branch.id,
    branch_name: s.branch.name,
    branch_color: s.branch.color,
    distance_km: Number(s.distance_km.toFixed(2)),
    proximity_score: Number(s.proximity_score.toFixed(3)),
    fairness_score: Number(s.fairness_need.toFixed(3)),
    spoilage_risk_score: Number(s.spoilage_risk_score.toFixed(3)),
    same_type_expiring_soon: s.same_type_expiring_soon,
    total_score: Number(s.score.toFixed(3)),
  }));

  return {
    candidates,
    excludedBranches: toExcludedInfo(branches),
    chosenBranchId: candidates[0]?.branch_id ?? null,
    coordinatorRationale: reason,
    usedAiAgents: false,
  };
}

/**
 * Runs the full multi-agent pipeline: one Branch Coordination Agent per
 * eligible branch (real function-calling tools, run in parallel), then one
 * Network Coordinator Agent that reviews every branch's report and makes
 * the actual routing decision. Falls back to the plain deterministic
 * weighted-score engine — same math, zero AI — if no API key is configured
 * or if the agent pipeline fails for any reason, so a live donation can
 * never get stuck on an AI outage.
 */
export async function runMatchingAgents(
  donorLat: number,
  donorLng: number,
  foodType: string,
  quantityKg: number,
  branches: MatchBranch[],
  existingInventory: { branch_id: string; food_type: string; expiry_at: string }[]
): Promise<AgentPipelineResult> {
  const eligible = branches.filter((b) => b.current_load_kg < b.capacity_kg);

  if (eligible.length === 0) {
    return {
      candidates: [],
      excludedBranches: toExcludedInfo(branches),
      chosenBranchId: null,
      coordinatorRationale: 'No branch currently has capacity for this donation.',
      usedAiAgents: false,
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    // The rationale below is shown to staff in the UI, so it stays free of
    // provider and environment-variable names. The actionable detail goes to
    // the server log instead, where whoever can fix it will actually see it.
    console.warn(
      '[agents] no model API key configured — routing is running on the deterministic ' +
        'engine only. Set GEMINI_API_KEY in .env.local to enable the AI agents.'
    );
    return runDeterministic(
      donorLat,
      donorLng,
      foodType,
      branches,
      existingInventory,
      'AI agents are not configured on this deployment — using the deterministic scoring engine directly.'
    );
  }

  try {
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Cheap pre-ranking (no API calls) so agent quota is only spent on
    // plausible candidates — a real coordinator wouldn't page every branch
    // in the network either, just the ones worth considering.
    const preRanked = scoreBranches({ donorLat, donorLng, foodType, branches, existingInventory });
    const shortlist = preRanked.slice(0, SHORTLIST_SIZE);
    const skipped = preRanked.slice(SHORTLIST_SIZE);

    const reports = await Promise.all(
      shortlist.map((s) =>
        runBranchAgent(genai, s.branch, donorLat, donorLng, foodType, quantityKg, existingInventory)
      )
    );

    const decision = await runCoordinatorAgent(genai, reports, foodType, quantityKg);

    const skippedInfo: ExcludedBranchInfo[] = skipped.map((s) => ({
      branch_id: s.branch.id,
      branch_name: s.branch.name,
      branch_color: s.branch.color,
      reason: `Not shortlisted — ranked below the top ${SHORTLIST_SIZE} by the deterministic pre-score (${s.branch.current_load_kg}/${s.branch.capacity_kg}kg used), so no AI agent was consulted for it, to conserve API quota.`,
      current_load_kg: s.branch.current_load_kg,
      capacity_kg: s.branch.capacity_kg,
    }));

    return {
      candidates: reportsToCandidates(reports),
      excludedBranches: [...toExcludedInfo(branches), ...skippedInfo],
      chosenBranchId: decision.chosen_branch_id,
      coordinatorRationale: decision.rationale,
      usedAiAgents: decision.agent_ok && reports.some((r) => r.agent_ok),
    };
  } catch (error) {
    console.error('agent pipeline failed, falling back to deterministic scoring:', error);
    return runDeterministic(
      donorLat,
      donorLng,
      foodType,
      branches,
      existingInventory,
      'The AI agent pipeline hit an error — using the deterministic scoring engine as a fallback.'
    );
  }
}

export { DEFAULT_MATCH_WEIGHTS };
