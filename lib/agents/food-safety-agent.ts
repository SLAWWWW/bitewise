import { GoogleGenAI, Type } from '@google/genai';
import { GEMINI_MODEL } from '@/lib/constants';
import { retrieveFoodSafetyCategory, computeDeterministicVerdict, escalateOnly } from '@/lib/algorithms/food-safety';
import type { FoodSafetyCheckResult, FoodSafetyVerdict, FoodType, StorageType } from '@/lib/types';

export interface FoodSafetyCheckInput {
  itemName: string;
  foodType: FoodType;
  storageType: StorageType;
  quantityKg: number;
  expiryHours: number;
  note?: string;
  /** Donor claims this was continuously hot-held at ≥60°C (buffet warmer,
   *  chafing dish) rather than sitting at ambient temperature — self-reported
   *  and unverifiable, so the AI layer is prompted to escalate rather than
   *  trust it at face value if the note suggests otherwise. */
  wasHotHeld?: boolean;
}

const AiVerdictSchema = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING, enum: ['good', 'warning', 'bad'] },
    score: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
    recommended_storage_type: { type: Type.STRING, enum: ['ambient', 'cold', 'frozen'], nullable: true },
    recommended_expiry_hours: { type: Type.NUMBER, nullable: true },
  },
  required: ['verdict', 'score', 'reasoning', 'recommended_storage_type', 'recommended_expiry_hours'],
};

function templatedReasoning(
  verdict: FoodSafetyVerdict,
  categoryLabel: string,
  ratio: number,
  safeMaxHours: number | null,
  wasHotHeld: boolean,
  insufficientHandlingTime: boolean,
  expiryHours: number
): string {
  if (insufficientHandlingTime) {
    return (
      `${categoryLabel} declared safe for only ${expiryHours}h from now — not rejected for being unsafe ` +
      `(a shorter window is, if anything, less risky than a longer one), but because there usually isn't ` +
      `enough real time left to collect, approve, and deliver this before it's gone. Declining now is more ` +
      `useful than accepting a donation that was never going to make it in time.`
    );
  }
  if (safeMaxHours === null) {
    return `${categoryLabel} is shelf-stable — no meaningful spoilage clock at the declared storage.`;
  }
  const window = wasHotHeld ? `${safeMaxHours}h hot-hold window (≥60°C)` : `${safeMaxHours}h limit for its storage type`;
  if (verdict === 'good') {
    return `${categoryLabel} declared within the safe window (${ratio}× the ${window}).`;
  }
  if (verdict === 'warning') {
    return `${categoryLabel} declared ${ratio}× the recommended ${window} — worth a second look before approving.`;
  }
  return `${categoryLabel} declared ${ratio}× the recommended ${window} — this exceeds food-safety guidance enough to reject outright.`;
}

/**
 * The standardized safety check every donation now passes through before a
 * listing is even created (PRD §7.7). Deterministic math computed from the
 * retrieved category is the safety floor — real, always available, and
 * exactly reproducible; Gemini adds a readable rationale and can escalate
 * severity if the free-text note reveals something the numbers alone
 * wouldn't catch (e.g. "been sitting in the van since this morning"), but
 * it can never soften a floor verdict. If the AI is unavailable or its
 * response doesn't parse, the deterministic verdict stands on its own,
 * `used_ai: false` — exactly this project's established fallback discipline,
 * just applied to a safety-facing decision instead of a routing one.
 */
export async function runFoodSafetyCheck(input: FoodSafetyCheckInput): Promise<FoodSafetyCheckResult> {
  const { itemName, foodType, storageType, quantityKg, expiryHours, note, wasHotHeld = false } = input;
  const { category, matched_keywords } = retrieveFoodSafetyCategory(itemName, foodType, note);
  const floor = computeDeterministicVerdict(category, storageType, expiryHours, wasHotHeld);

  const base: FoodSafetyCheckResult = {
    verdict: floor.verdict,
    score: floor.verdict === 'good' ? 90 : floor.verdict === 'warning' ? 55 : 15,
    category_key: category.key,
    category_label: category.label,
    perishable: category.perishable,
    requires_cold_chain: category.requires_cold_chain,
    safe_temp_note: category.safe_temp_note,
    ratio: floor.ratio,
    reasoning: templatedReasoning(
      floor.verdict,
      category.label,
      floor.ratio,
      floor.safe_max_hours,
      wasHotHeld,
      floor.insufficient_handling_time,
      expiryHours
    ),
    used_ai: false,
  };

  if (!process.env.GEMINI_API_KEY) return base;

  try {
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `A donor is submitting a food donation with these declared details:
- Item: ${itemName}
- Quantity: ${quantityKg}kg
- Declared storage: ${storageType}
- Continuously hot-held at ≥60°C until now (buffet warmer/chafing dish), not sitting at ambient
  temperature: ${wasHotHeld ? 'YES, donor claims this' : 'no'}
- Declared time until it spoils, counting from right now (already accounts for any time it's
  already spent sitting out — it is NOT extra time on top of that): ${expiryHours} hours
- Donor's note: ${note || '(none provided)'}

Retrieved food-safety category: ${category.label} (matched keywords: ${matched_keywords.join(', ') || 'none — matched by declared food type instead'}).
Perishable: ${category.perishable}. Requires cold chain: ${category.requires_cold_chain}. ${category.safe_temp_note}
Deterministic safety floor already computed from this category: "${floor.verdict}" (declared shelf life is ${floor.ratio}× the recommended safe maximum${floor.safe_max_hours !== null ? ` of ${floor.safe_max_hours} hours` : ''}${wasHotHeld && floor.safe_max_hours !== null ? ' for continuous hot-holding, not the shorter ambient window' : ' for the declared storage type'}).

${floor.insufficient_handling_time ? `This "bad" floor is NOT a food-safety claim — a ${expiryHours}h window is chemically fine, if anything less risky than a longer one. It's an operational floor: this category is high-risk enough that under 2 hours rarely leaves real time to collect, approve, and deliver it before it's gone. In your reasoning, say exactly that — do not invent or imply a food-safety hazard that isn't there, and do not contradict this by claiming the food is somehow unsafe.\n\n` : ''}${wasHotHeld ? "The hot-hold claim is self-reported and cannot be verified from here — genuinely continuous ≥60°C holding (a real commercial warmer or chafing dish actively maintained) is safe for much longer than sitting at ambient, but food that was only briefly warm, reheated once, or left under a dying sterno flame is NOT hot-held in the safety sense. If the item name or note gives any reason to doubt the temperature was truly maintained throughout (e.g. it mentions being moved, cooling, sitting out, or uncertainty), escalate toward the ambient window instead of trusting the claim at face value — you may escalate above the deterministic floor for this reason even though the floor itself already gave the donor the benefit of the doubt.\n\n" : ''}Assess this donation's food safety. You may escalate the verdict to something more severe than the deterministic floor if the note or details reveal a real additional hazard, but you must never report a verdict less severe than the floor above — treat it as a hard minimum. In your reasoning, always phrase the ${expiryHours}h figure as "still needs to stay safe/edible for ${expiryHours} more hours from now" (never as "has already been stored for ${expiryHours} hours") — if the note mentions time already elapsed, reconcile the two explicitly (e.g. note that even accounting for time already elapsed, the remaining declared window still exceeds the safe maximum) rather than leaving them looking contradictory. Give a 0-100 safety score matching your verdict (good ≈ 70-100, warning ≈ 40-69, bad ≈ 0-39), plain-language reasoning a charity staff member would find useful, and only if the storage or expiry looks meaningfully wrong, a recommended correction.`;

    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        // A slow-but-alive call never throws on its own, so without this it
        // can hang the request indefinitely instead of ever reaching the
        // deterministic fallback below.
        httpOptions: { timeout: 12000 },
        systemInstruction:
          'You are a food-safety verification assistant for a charity donation intake form, standing between the public form and a human approval queue. You are grounded in a retrieved food-safety category and a pre-computed deterministic floor verdict — never report a verdict less severe than that floor, only equal or worse. Be conservative and concrete.',
        responseMimeType: 'application/json',
        responseSchema: AiVerdictSchema,
        maxOutputTokens: 1024,
      },
    });

    if (!response.text) return base;

    const parsed = JSON.parse(response.text) as {
      verdict: FoodSafetyVerdict;
      score: number;
      reasoning: string;
      recommended_storage_type: StorageType | null;
      recommended_expiry_hours: number | null;
    };

    const finalVerdict = escalateOnly(floor.verdict, parsed.verdict);
    // escalateOnly can reject the model's proposed verdict (when it tried to
    // soften the floor) without rejecting its score/reasoning too — those
    // still describe the verdict it proposed, not the floor that overrode
    // it. When that happens, fall back to the floor's own score/reasoning
    // (already computed in `base`) so the three fields never contradict
    // each other on screen.
    const wasOverridden = finalVerdict !== parsed.verdict;
    // A 'good' verdict means nothing needs correcting — there's nothing to
    // recommend instead of. And even on a real warning/bad verdict, a
    // "recommendation" that just echoes the storage type already declared
    // reads as nonsensical ("declared at ambient instead" when ambient is
    // what was declared) — only a genuinely different storage type is an
    // actual correction. The prompt already tells the model to only propose
    // one "if the storage or expiry looks meaningfully wrong," but models
    // don't always follow that reliably; enforce it here instead of trusting
    // the model alone.
    // Also suppressed when the floor rejected for insufficient handling time
    // — a different storage type doesn't fix "there wasn't enough time,"
    // so suggesting one here would be its own kind of misleading.
    const suggestsCorrection =
      finalVerdict !== 'good' &&
      !floor.insufficient_handling_time &&
      parsed.recommended_storage_type != null &&
      parsed.recommended_storage_type !== storageType;
    return {
      ...base,
      verdict: finalVerdict,
      score: wasOverridden ? base.score : Math.max(0, Math.min(100, Math.round(parsed.score))),
      reasoning: wasOverridden ? base.reasoning : parsed.reasoning,
      used_ai: true,
      recommended_storage_type: suggestsCorrection ? parsed.recommended_storage_type : null,
      recommended_expiry_hours: suggestsCorrection ? parsed.recommended_expiry_hours : null,
    };
  } catch (error) {
    console.error('[food-safety-agent] AI check failed — using deterministic floor verdict only:', error);
    return base;
  }
}
