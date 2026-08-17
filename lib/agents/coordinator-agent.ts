import { GoogleGenAI, Type } from '@google/genai';
import { GEMINI_MODEL } from '@/lib/constants';
import type { BranchAgentReport } from './branch-agent';

export interface CoordinatorDecision {
  chosen_branch_id: string;
  rationale: string;
  agent_ok: boolean;
}


/**
 * The Network Coordinator Agent. It receives every Branch Coordination
 * Agent's tool-verified numbers and rationale, and makes the actual routing
 * decision — it isn't just narrating whatever scored highest. It's allowed
 * to disagree with the raw top score if the reports give it a real reason
 * to (a genuine autonomous decision), but it can only choose a branch that
 * was actually reported as eligible — a response naming anything else, or
 * any failure calling the model, falls back to the highest-scoring branch
 * so a bad/unavailable model call can never break a live donation flow.
 */
export async function runCoordinatorAgent(
  genai: GoogleGenAI,
  reports: BranchAgentReport[],
  foodType: string,
  quantityKg: number
): Promise<CoordinatorDecision> {
  const fallbackChoice = [...reports].sort((a, b) => b.total_score - a.total_score)[0];

  const summary = reports
    .map(
      (r) =>
        `- ${r.branch_name} (id: ${r.branch_id}): proximity ${(r.proximity_score * 100).toFixed(0)}%, fairness need ${(
          r.fairness_score * 100
        ).toFixed(0)}%, spoilage risk score ${(r.spoilage_risk_score * 100).toFixed(0)}%, combined score ${(
          r.total_score * 100
        ).toFixed(0)}%. This branch's own agent said: "${r.rationale}"`
    )
    .join('\n');

  try {
    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `You are the Network Coordinator Agent for Willing Hearts. ${reports.length} Branch Coordination Agents have each reported on whether their branch should receive a donation of ${quantityKg}kg of ${foodType}:\n\n${summary}\n\nDecide which single branch should receive this donation. You may agree with the highest combined score, or choose a different branch if the reports give you a well-justified reason to (for example a close tie where one branch's spoilage risk or fairness need is the bigger real-world concern). Base your decision only on the numbers and reports above — do not invent information the agents didn't report.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            chosen_branch_id: { type: Type.STRING, enum: reports.map((r) => r.branch_id) },
            rationale: { type: Type.STRING },
          },
          required: ['chosen_branch_id', 'rationale'],
        },
        maxOutputTokens: 512,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    const validIds = new Set(reports.map((r) => r.branch_id));
    if (typeof parsed.chosen_branch_id === 'string' && validIds.has(parsed.chosen_branch_id)) {
      return {
        chosen_branch_id: parsed.chosen_branch_id,
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
        agent_ok: true,
      };
    }
    throw new Error(`Coordinator returned an invalid branch id: ${parsed.chosen_branch_id}`);
  } catch (error) {
    console.error('coordinator agent failed:', error);
    return {
      chosen_branch_id: fallbackChoice.branch_id,
      rationale: `Routed to ${fallbackChoice.branch_name}, the highest-scoring branch — the coordinator agent was unavailable, so this is the deterministic fallback.`,
      agent_ok: false,
    };
  }
}
