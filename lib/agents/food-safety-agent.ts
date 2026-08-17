import { GoogleGenAI, Type } from '@google/genai';
import { retrieveFoodSafetyCategory, computeDeterministicVerdict, escalateOnly } from '@/lib/algorithms/food-safety';
import type { FoodSafetyCheckResult, FoodSafetyVerdict, FoodType, StorageType } from '@/lib/types';

const MODEL = 'gemini-3.5-flash-lite';

export interface FoodSafetyCheckInput {
  itemName: string;
  foodType: FoodType;
  storageType: StorageType;
  quantityKg: number;
  expiryHours: number;
  note?: string;
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

function templatedReasoning(verdict: FoodSafetyVerdict, categoryLabel: string, ratio: number, safeMaxHours: number | null): string {
  if (safeMaxHours === null) {
    return `${categoryLabel} is shelf-stable — no meaningful spoilage clock at the declared storage.`;
  }
  if (verdict === 'good') {
    return `${categoryLabel} declared within the safe window for its storage type (${ratio}× the ${safeMaxHours}h limit).`;
  }
  if (verdict === 'warning') {
    return `${categoryLabel} declared ${ratio}× the recommended ${safeMaxHours}h safe window for its storage type — worth a second look before approving.`;
  }
  return `${categoryLabel} declared ${ratio}× the recommended ${safeMaxHours}h safe window for its storage type — this exceeds food-safety guidance enough to reject outright.`;
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
  const { itemName, foodType, storageType, quantityKg, expiryHours, note } = input;
  const { category, matched_keywords } = retrieveFoodSafetyCategory(itemName, foodType, note);
  const floor = computeDeterministicVerdict(category, storageType, expiryHours);

  const base: FoodSafetyCheckResult = {
    verdict: floor.verdict,
    score: floor.verdict === 'good' ? 90 : floor.verdict === 'warning' ? 55 : 15,
    category_key: category.key,
    category_label: category.label,
    perishable: category.perishable,
    requires_cold_chain: category.requires_cold_chain,
    safe_temp_note: category.safe_temp_note,
    ratio: floor.ratio,
    reasoning: templatedReasoning(floor.verdict, category.label, floor.ratio, floor.safe_max_hours),
    used_ai: false,
  };

  if (!process.env.GEMINI_API_KEY) return base;

  try {
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `A donor is submitting a food donation with these declared details:
- Item: ${itemName}
- Quantity: ${quantityKg}kg
- Declared storage: ${storageType}
- Declared time until it spoils: ${expiryHours} hours
- Donor's note: ${note || '(none provided)'}

Retrieved food-safety category: ${category.label} (matched keywords: ${matched_keywords.join(', ') || 'none — matched by declared food type instead'}).
Perishable: ${category.perishable}. Requires cold chain: ${category.requires_cold_chain}. ${category.safe_temp_note}
Deterministic safety floor already computed from this category: "${floor.verdict}" (declared shelf life is ${floor.ratio}× the recommended safe maximum for the declared storage type${floor.safe_max_hours !== null ? ` of ${floor.safe_max_hours} hours` : ''}).

Assess this donation's food safety. You may escalate the verdict to something more severe than the deterministic floor if the note or details reveal a real additional hazard, but you must never report a verdict less severe than the floor above — treat it as a hard minimum. Give a 0-100 safety score matching your verdict (good ≈ 70-100, warning ≈ 40-69, bad ≈ 0-39), plain-language reasoning a charity staff member would find useful, and only if the storage or expiry looks meaningfully wrong, a recommended correction.`;

    const response = await genai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
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
    return {
      ...base,
      verdict: finalVerdict,
      score: wasOverridden ? base.score : Math.max(0, Math.min(100, Math.round(parsed.score))),
      reasoning: wasOverridden ? base.reasoning : parsed.reasoning,
      used_ai: true,
      recommended_storage_type: parsed.recommended_storage_type,
      recommended_expiry_hours: parsed.recommended_expiry_hours,
    };
  } catch (error) {
    console.error('[food-safety-agent] AI check failed — using deterministic floor verdict only:', error);
    return base;
  }
}
