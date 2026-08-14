import { GoogleGenAI, Type, FunctionCallingConfigMode, type CallableTool, type Part } from '@google/genai';
import type { DonorImpactMessage, ToolCallTrace } from '@/lib/types';

const MODEL = 'gemini-3.5-flash-lite';

export interface DonorImpactInput {
  donorId: string;
  donorName: string;
  /** All approved donations for this donor — pre-fetched before the agent call. */
  donations: {
    item_name: string;
    food_type: string;
    quantity_kg: number;
    matched_at: string | null;
  }[];
}

/** Pre-computed stats derived from the raw donations list. */
export interface DonationHistory {
  count: number;
  total_kg: number;
  most_recent_donation: string | null;
  most_donated_food_type: string | null;
}

function computeHistory(donations: DonorImpactInput['donations']): DonationHistory {
  if (donations.length === 0) {
    return { count: 0, total_kg: 0, most_recent_donation: null, most_donated_food_type: null };
  }

  const total_kg = donations.reduce((s, d) => s + (d.quantity_kg ?? 0), 0);

  // Most recent by matched_at date.
  const sorted = [...donations].sort((a, b) => {
    const ta = a.matched_at ? new Date(a.matched_at).getTime() : 0;
    const tb = b.matched_at ? new Date(b.matched_at).getTime() : 0;
    return tb - ta;
  });
  const most_recent_donation = sorted[0].item_name;

  // Most donated food type by total kg.
  const byType: Record<string, number> = {};
  for (const d of donations) {
    byType[d.food_type] = (byType[d.food_type] ?? 0) + (d.quantity_kg ?? 0);
  }
  const most_donated_food_type = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { count: donations.length, total_kg: Number(total_kg.toFixed(1)), most_recent_donation, most_donated_food_type };
}

/**
 * Creates the `get_donation_history` tool closed over real pre-fetched data.
 * The model cannot hallucinate the numbers — it can only read what we provide.
 */
function createDonorImpactTool(input: DonorImpactInput, log: ToolCallTrace[]): CallableTool {
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

  return {
    tool: async () => ({
      functionDeclarations: [
        {
          name: 'get_donation_history',
          description:
            'Returns this donor\'s full contribution history: how many donations they\'ve made, the total weight in kg, their most recent donation item, and the food type they donate most. Call this before drafting the message — do not invent any of these numbers.',
          parametersJsonSchema: { type: 'object', properties: {} },
        },
      ],
    }),
    callTool: async (): Promise<Part[]> =>
      resolve('get_donation_history', () => {
        const h = computeHistory(input.donations);
        const meals = Math.round(h.total_kg * 2);
        const co2_kg = Number((h.total_kg * 2.5).toFixed(1));
        return {
          donor_id: input.donorId,
          donor_name: input.donorName,
          donation_count: h.count,
          total_kg: h.total_kg,
          meals_equivalent: meals,
          co2_avoided_kg: co2_kg,
          most_recent_donation_item: h.most_recent_donation,
          most_donated_food_type: h.most_donated_food_type,
        };
      }),
  };
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    message: { type: Type.STRING },
  },
  required: ['message'],
};

/** Templated fallback — used when there is no GEMINI_API_KEY or the model call fails. */
export function buildDeterministicMessage(input: DonorImpactInput): DonorImpactMessage {
  const h = computeHistory(input.donations);
  const meals = Math.round(h.total_kg * 2);
  const co2 = (h.total_kg * 2.5).toFixed(1);

  let message: string;
  if (h.count === 0) {
    message =
      `Dear ${input.donorName}, thank you for being part of the Willing Hearts community. ` +
      `We look forward to receiving your first donation and putting it to work for the families we serve. ` +
      `Every kilogram makes a difference — we'd love to have you donate again soon.`;
  } else {
    const typePhrase = h.most_donated_food_type ? ` — especially your ${h.most_donated_food_type} contributions` : '';
    const recentPhrase = h.most_recent_donation ? ` Your most recent donation of ${h.most_recent_donation} was put straight to work.` : '';
    message =
      `Dear ${input.donorName}, your generosity${typePhrase} has added up to ` +
      `${h.total_kg.toLocaleString('en-SG')}kg across ${h.count} donation${h.count === 1 ? '' : 's'} — ` +
      `the equivalent of roughly ${meals.toLocaleString('en-SG')} meals and ${co2}kg of CO₂ avoided.` +
      `${recentPhrase} ` +
      `Thank you for making this possible. We'd be delighted to welcome another donation from you whenever you're ready.`;
  }

  return {
    message,
    generated_by_ai: false,
    generated_at: new Date().toISOString(),
  };
}

/**
 * The Donor Impact Agent. Drafts a personalised ~80–120 word thank-you /
 * impact update for one donor, grounded in their real contribution history via
 * a single `get_donation_history` tool call. Advisory only — it drafts;
 * a human reviews and sends.
 */
export async function runDonorImpactAgent(input: DonorImpactInput): Promise<DonorImpactMessage> {
  const fallback = buildDeterministicMessage(input);
  if (!process.env.GEMINI_API_KEY) return fallback;

  const toolLog: ToolCallTrace[] = [];
  const tool = createDonorImpactTool(input, toolLog);

  const prompt = `You are the Donor Relations Agent for Willing Hearts, a Singapore food-redistribution charity. Your job is to draft one short, warm, specific thank-you / impact update for a single donor.

DONOR: ${input.donorName}

You have access to one tool: get_donation_history. Call it first — do NOT invent any statistics. Once you have the real numbers, draft a message of 80–120 words that:
- Opens with the donor's name
- Cites the real total kg, meals equivalent, and CO₂ avoided from the tool
- Mentions the food type they donate most (if available)
- Names their most recent donation item (if available)
- Closes with a warm, genuine invitation to donate again
- Sounds like it was written by a real person, not a template
- Never mentions "Gemini", "AI", or any model name
- Uses "we" and "Willing Hearts", not third-person references to the charity

Return only the drafted message text — no preamble, no subject line, no sign-off beyond what's natural.`;

  try {
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await genai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        tools: [tool],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 512,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';

    if (!message) throw new Error('donor impact agent returned empty message');

    return {
      message,
      generated_by_ai: true,
      tool_calls: toolLog,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error('donor impact agent failed, using deterministic message:', error);
    return fallback;
  }
}
