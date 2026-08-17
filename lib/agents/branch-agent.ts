import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import { GEMINI_MODEL } from '@/lib/constants';
import { haversine } from '@/lib/utils/geo';
import { createBranchAgentTools, type ToolCallRecord } from './tools';

export interface BranchAgentBranch {
  id: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  current_load_kg: number;
  capacity_kg: number;
}

export interface BranchAgentReport {
  branch_id: string;
  branch_name: string;
  branch_color: string;
  distance_km: number;
  proximity_score: number;
  fairness_score: number;
  spoilage_risk_score: number;
  same_type_expiring_soon: number;
  total_score: number;
  rationale: string;
  tool_calls: ToolCallRecord[];
  agent_ok: boolean;
}

const WEIGHTS = { proximity: 0.3, fairness: 0.5, spoilage: 0.2 };

/**
 * The Branch Coordination Agent for one branch. It has three real tools
 * (function calling, not simulated) and decides for itself whether and when
 * to call them — the model is not told the numbers, it has to go get them.
 * The final total_score is still computed by this function from whatever
 * the tools actually returned (falling back to a direct deterministic call
 * for any tool the model skipped), so an incomplete or lazy agent run can
 * never produce a wrong ranking — only a weaker rationale.
 */
export async function runBranchAgent(
  genai: GoogleGenAI,
  branch: BranchAgentBranch,
  donorLat: number,
  donorLng: number,
  foodType: string,
  quantityKg: number,
  existingInventory: { branch_id: string; food_type: string; expiry_at: string }[]
): Promise<BranchAgentReport> {
  const toolLog: ToolCallRecord[] = [];
  const tools = createBranchAgentTools(
    {
      branchId: branch.id,
      branchLat: branch.lat,
      branchLng: branch.lng,
      branchCurrentLoadKg: branch.current_load_kg,
      branchCapacityKg: branch.capacity_kg,
      donorLat,
      donorLng,
      foodType,
      existingInventory,
    },
    toolLog
  );

  let rationale = '';
  try {
    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `You are the Branch Coordination Agent for ${branch.name}, part of the Willing Hearts network. A donor wants to give ${quantityKg}kg of ${foodType}. You MUST call all three of your tools — get_proximity_score, get_fairness_need_score, and get_spoilage_risk_score — to gather real data before answering; never guess these numbers yourself. Then write a concise one or two sentence assessment of whether your branch is a good destination for this donation, referencing the actual numbers your tools returned.`,
      config: {
        tools,
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        maxOutputTokens: 512,
      },
    });
    rationale = response.text?.trim() ?? '';
  } catch (error) {
    console.error(`branch agent failed for ${branch.name}:`, error);
  }

  // Safety net: fill in anything the agent's tool calls didn't cover, so the
  // score is always complete even if the model skipped a step or errored.
  const dist = haversine(donorLat, donorLng, branch.lat, branch.lng);
  const proximityFallback = 1 / (1 + dist * 10);
  const saturation = branch.capacity_kg > 0 ? branch.current_load_kg / branch.capacity_kg : 1;
  const fairnessFallback = 1 - saturation;
  const now = Date.now();
  const sameTypeCountFallback = existingInventory.filter((item) => {
    if (item.branch_id !== branch.id || item.food_type !== foodType) return false;
    const hoursLeft = (new Date(item.expiry_at).getTime() - now) / (1000 * 60 * 60);
    return hoursLeft > 0 && hoursLeft <= 24;
  }).length;
  const spoilageFallback = 1 / (1 + sameTypeCountFallback * 0.5);

  const proximityCall = [...toolLog].reverse().find((t) => t.name === 'get_proximity_score');
  const fairnessCall = [...toolLog].reverse().find((t) => t.name === 'get_fairness_need_score');
  const spoilageCall = [...toolLog].reverse().find((t) => t.name === 'get_spoilage_risk_score');

  const proximity_score = (proximityCall?.result.score as number | undefined) ?? proximityFallback;
  const distance_km = (proximityCall?.result.distance_km as number | undefined) ?? dist;
  const fairness_score = (fairnessCall?.result.score as number | undefined) ?? fairnessFallback;
  const spoilage_risk_score = (spoilageCall?.result.score as number | undefined) ?? spoilageFallback;
  const same_type_expiring_soon =
    (spoilageCall?.result.same_type_expiring_soon as number | undefined) ?? sameTypeCountFallback;

  const total_score =
    WEIGHTS.proximity * proximity_score + WEIGHTS.fairness * fairness_score + WEIGHTS.spoilage * spoilage_risk_score;

  return {
    branch_id: branch.id,
    branch_name: branch.name,
    branch_color: branch.color,
    distance_km,
    proximity_score,
    fairness_score,
    spoilage_risk_score,
    same_type_expiring_soon,
    total_score,
    rationale: rationale || 'No assessment available — this branch fell back to deterministic scoring only.',
    tool_calls: toolLog,
    agent_ok: rationale !== '',
  };
}
