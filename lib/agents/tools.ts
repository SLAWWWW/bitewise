import type { CallableTool, Part } from '@google/genai';
import { haversine } from '@/lib/utils/geo';

export interface BranchAgentContext {
  branchId: string;
  branchLat: number;
  branchLng: number;
  branchCurrentLoadKg: number;
  branchCapacityKg: number;
  donorLat: number;
  donorLng: number;
  foodType: string;
  existingInventory: { branch_id: string; food_type: string; expiry_at: string }[];
}

export interface ToolCallRecord {
  name: string;
  result: Record<string, unknown>;
}

/**
 * Real function-calling tools for a Branch Coordination Agent. Each tool is
 * closed over one specific branch + donation context, so the model never has
 * to pass (and can't hallucinate) coordinates or inventory data as
 * arguments — it only decides *when* to call each tool. The underlying
 * arithmetic is the exact same deterministic formula used everywhere else in
 * the app (see lib/algorithms/matching.ts), so a tool call always returns a
 * trustworthy number; the model's job is orchestration and explanation, not
 * arithmetic.
 */
export function createBranchAgentTools(ctx: BranchAgentContext, log: ToolCallRecord[]): CallableTool[] {
  // Every tool here is a pure function of the branch+donation context, so a
  // repeat call within one decision can only ever return the same answer.
  // Gemini's automatic function calling sometimes re-runs the whole tool set
  // for a second round before answering; memoising makes those repeats free
  // and keeps the persisted trace to one honest entry per distinct tool
  // instead of the same three results twice.
  const memo = new Map<string, Record<string, unknown>>();

  function resolve(name: string, compute: () => Record<string, unknown>): Part[] {
    let response = memo.get(name);
    if (!response) {
      response = compute();
      memo.set(name, response);
      log.push({ name, result: response });
    }
    return [{ functionResponse: { name, response } }];
  }

  const proximityTool: CallableTool = {
    tool: async () => ({
      functionDeclarations: [
        {
          name: 'get_proximity_score',
          description:
            "Computes how close this branch is to the donor's pickup location. Returns a 0-1 score (1 = essentially co-located, lower = farther away) and the raw distance in kilometers.",
          parametersJsonSchema: { type: 'object', properties: {} },
        },
      ],
    }),
    callTool: async (): Promise<Part[]> =>
      resolve('get_proximity_score', () => {
        const distance_km = haversine(ctx.donorLat, ctx.donorLng, ctx.branchLat, ctx.branchLng);
        return { score: 1 / (1 + distance_km * 10), distance_km };
      }),
  };

  const fairnessTool: CallableTool = {
    tool: async () => ({
      functionDeclarations: [
        {
          name: 'get_fairness_need_score',
          description:
            'Computes how much free capacity this branch has relative to its own size, as a 0-1 score (1 = nearly empty and badly needs more stock, 0 = already full). Also returns the current load and total capacity in kg.',
          parametersJsonSchema: { type: 'object', properties: {} },
        },
      ],
    }),
    callTool: async (): Promise<Part[]> =>
      resolve('get_fairness_need_score', () => {
        const saturation =
          ctx.branchCapacityKg > 0 ? ctx.branchCurrentLoadKg / ctx.branchCapacityKg : 1;
        return {
          score: 1 - saturation,
          current_load_kg: ctx.branchCurrentLoadKg,
          capacity_kg: ctx.branchCapacityKg,
        };
      }),
  };

  const spoilageTool: CallableTool = {
    tool: async () => ({
      functionDeclarations: [
        {
          name: 'get_spoilage_risk_score',
          description:
            'Checks how much of the SAME food type this branch already has expiring within the next 24 hours. Returns a 0-1 score (1 = no risk, lower = this branch already has a glut of the same food type about to spoil) and the count of matching near-expiry items.',
          parametersJsonSchema: { type: 'object', properties: {} },
        },
      ],
    }),
    callTool: async (): Promise<Part[]> =>
      resolve('get_spoilage_risk_score', () => {
        const now = Date.now();
        const same_type_expiring_soon = ctx.existingInventory.filter((item) => {
          if (item.branch_id !== ctx.branchId) return false;
          if (item.food_type !== ctx.foodType) return false;
          const hoursLeft = (new Date(item.expiry_at).getTime() - now) / (1000 * 60 * 60);
          return hoursLeft > 0 && hoursLeft <= 24;
        }).length;
        return { score: 1 / (1 + same_type_expiring_soon * 0.5), same_type_expiring_soon };
      }),
  };

  return [proximityTool, fairnessTool, spoilageTool];
}
