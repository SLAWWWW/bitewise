import { GoogleGenAI, Type } from '@google/genai';
import type { SupplyChainPlan } from '@/lib/types';

const MODEL = 'gemini-3.5-flash-lite';

export interface PickupWindowInput {
  /** Hours from right now until the item's expiry_at. */
  hoursRemaining: number;
  foodType: string;
  storageType: string;
  /** The listing's cached supply chain plan, if one exists — extra context on
   *  how tight the rest of this donation's timeline already is. */
  cachedPlan?: SupplyChainPlan | null;
}

export interface PickupWindowResult {
  minutes: number;
  rationale: string;
  used_ai: boolean;
}

const AiWindowSchema = {
  type: Type.OBJECT,
  properties: {
    minutes: { type: Type.NUMBER },
    rationale: { type: Type.STRING },
  },
  required: ['minutes', 'rationale'],
};

/** Base minutes by urgency tier, matching `describeShelfLife`'s own tier
 *  boundaries (lib/storage-zones.ts) so the countdown's sense of "urgent"
 *  never disagrees with what the shelf-life badge already says. */
function tierBaseMinutes(hoursRemaining: number): number {
  if (hoursRemaining < 6) return 30;
  if (hoursRemaining < 24) return 90;
  if (hoursRemaining < 72) return 180;
  return 360;
}

/** Exported for direct unit testing — also the bound Gemini's own recommendation
 *  is clamped through, so the AI can propose a window but never one so loose
 *  it stops being conservative. */
export function clampMinutes(minutes: number, hoursRemaining: number): number {
  const ceiling = Math.min(480, hoursRemaining * 60 * 0.5);
  return Math.max(10, Math.min(minutes, ceiling));
}

export function deterministicWindow(input: PickupWindowInput): PickupWindowResult {
  const minutes = clampMinutes(tierBaseMinutes(input.hoursRemaining), input.hoursRemaining);
  return {
    minutes: Math.round(minutes),
    rationale: `${Math.round(minutes)} minutes to collect, based on ${input.hoursRemaining.toFixed(1)}h left before this ${input.foodType} item spoils.`,
    used_ai: false,
  };
}

/**
 * How long a recipient has to actually collect an item once they reserve it
 * — always computed here, never a fixed constant, so a claim on something
 * with six hours left doesn't get treated the same as a claim on something
 * with six days left. The deterministic tier-based formula is the floor and
 * the always-available fallback; Gemini can tighten or loosen it within a
 * bounded range using the item's real remaining shelf life and, when one
 * exists, the cached supply chain plan's own sense of how tight this
 * donation's timeline already is.
 */
export async function computePickupWindow(input: PickupWindowInput): Promise<PickupWindowResult> {
  const floor = deterministicWindow(input);
  if (!process.env.GEMINI_API_KEY) return floor;

  try {
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const planContext = input.cachedPlan
      ? `A supply chain plan already exists for this donation: "${input.cachedPlan.headline}" — total window from pickup to write-off is ${input.cachedPlan.total_window_hours}h, and its contingency for going unclaimed is: "${input.cachedPlan.contingency.trigger}".`
      : 'No supply chain plan is cached for this donation yet.';

    const prompt = `A recipient just reserved a food item on a charity's public claim page. Decide how many minutes they should be given to physically collect it before the reservation releases automatically back to the public list.

Food type: ${input.foodType}
Storage type: ${input.storageType}
Hours remaining until this specific item spoils: ${input.hoursRemaining.toFixed(2)}
${planContext}
A conservative deterministic estimate is ${floor.minutes} minutes.

Give a pickup window in minutes appropriate to how urgent this is — tighter for something spoiling soon, more generous for something with days left, but never so generous that the window itself risks the food going bad before the deadline. Briefly explain your reasoning in one sentence.`;

    const response = await genai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          'You set pickup deadlines for a food-rescue charity. Be conservative — an item that spoils soon needs a short window; never recommend a window that risks the food spoiling before the deadline arrives.',
        responseMimeType: 'application/json',
        responseSchema: AiWindowSchema,
        maxOutputTokens: 512,
      },
    });

    if (!response.text) return floor;
    const parsed = JSON.parse(response.text) as { minutes: number; rationale: string };
    const minutes = Math.round(clampMinutes(parsed.minutes, input.hoursRemaining));
    return { minutes, rationale: parsed.rationale, used_ai: true };
  } catch (error) {
    console.error('[pickup-window-agent] AI call failed — using deterministic window only:', error);
    return floor;
  }
}
