import { FOOD_SAFETY_CATEGORIES, type FoodSafetyCategory } from '@/lib/knowledge/food-safety';
import type { FoodSafetyVerdict, FoodType, StorageType } from '@/lib/types';

/**
 * Retrieval step: picks the food-safety category that actually matches what
 * a donor typed, rather than trusting the food_type dropdown alone — a donor
 * who selects "other" but types "roast chicken" still gets scored as
 * high-risk cooked food, not the conservative uncategorized default. This is
 * what makes the standard apply the same way no matter how the item is
 * worded — the whole point of retrieving against one shared corpus instead
 * of eight fixed buckets.
 */
export function retrieveFoodSafetyCategory(
  itemName: string,
  foodType: FoodType,
  note?: string
): { category: FoodSafetyCategory; matched_keywords: string[] } {
  const haystack = `${itemName} ${note ?? ''}`.toLowerCase();

  let bestScore = 0;
  const tiedForBest: FoodSafetyCategory[] = [];
  const matchesByKey = new Map<string, string[]>();

  for (const category of FOOD_SAFETY_CATEGORIES) {
    const matches = category.keywords.filter((kw) => haystack.includes(kw));
    if (matches.length === 0) continue;
    matchesByKey.set(category.key, matches);
    if (matches.length > bestScore) {
      bestScore = matches.length;
      tiedForBest.length = 0;
      tiedForBest.push(category);
    } else if (matches.length === bestScore) {
      tiedForBest.push(category);
    }
  }

  if (tiedForBest.length > 0) {
    // Two categories can score an equal number of keyword hits (e.g. "Canned
    // Vegetables" matches both `canned_goods` and `whole_fresh_produce`) —
    // when that happens, defer to the donor's own food_type selection rather
    // than an arbitrary array-order pick, since the dropdown is a real signal
    // the retrieval step shouldn't ignore just because *some* category matched.
    const agreesWithDropdown = tiedForBest.find((c) => c.default_food_types.includes(foodType));
    const chosen = agreesWithDropdown ?? tiedForBest[0];
    return { category: chosen, matched_keywords: matchesByKey.get(chosen.key) ?? [] };
  }

  const byDropdown = FOOD_SAFETY_CATEGORIES.find((c) => c.default_food_types.includes(foodType));
  if (byDropdown) {
    return { category: byDropdown, matched_keywords: [] };
  }

  const fallback = FOOD_SAFETY_CATEGORIES.find((c) => c.key === 'uncategorized')!;
  return { category: fallback, matched_keywords: [] };
}

/** Below this, a high-risk perishable donation is declined regardless of how
 *  safe the food technically still is right now — not a food-safety claim
 *  (a 1-hour item is chemically *less* risky than a 2-hour one, not more),
 *  an operational one: there usually isn't real time left to collect,
 *  approve, and deliver something before it's gone, so it sits in a queue
 *  it can't beat and ends up wasted anyway. Declining it plainly is more
 *  useful than accepting a donation that was never going to make it. */
export const MINIMUM_HANDLING_HOURS = 2;

function safeMaxHoursFor(
  category: FoodSafetyCategory,
  storageType: StorageType,
  wasHotHeld: boolean
): number | null {
  // Continuously hot-held (≥60°C, buffet warmer/chafing dish) never enters
  // the 5°C–60°C danger zone at all, regardless of what the donor picked as
  // the storage type going forward — the elapsed time so far was governed by
  // the hot-hold window, not the ambient one. `null` on the category (e.g.
  // dairy, produce — states hot-holding doesn't apply to) falls through to
  // the declared storage type's own limit instead of granting an exemption
  // that was never real.
  if (wasHotHeld && category.max_hot_hours !== null) return category.max_hot_hours;
  if (storageType === 'ambient') return category.max_ambient_hours;
  if (storageType === 'cold') return category.max_cold_hours;
  return category.max_frozen_hours;
}

/**
 * Deterministic verdict — the safety floor. Ratio of declared shelf life to
 * the safe maximum for the declared storage: at or under 1× is fine, past
 * that is a real hazard growing worse the further over it goes. A `null`
 * safe max means the category has no meaningful ambient-time hazard (canned
 * goods, dry goods, sealed drinks) so anything is `good`.
 *
 * Thresholds: ≤1× → good, 1×–2.5× → warning, >2.5× → bad. 2.5× was chosen
 * because it already requires being wrong about BOTH storage and duration —
 * a single honest mistake (e.g. cooked food chilled for 3 days against a
 * 72h max) still lands at exactly 1×, not past it.
 *
 * Checked before any of that: high-risk, cold-chain-relevant categories
 * (cooked meals, dairy, cream-filled bakery, thawed frozen) declined outright
 * under `MINIMUM_HANDLING_HOURS`, regardless of ratio — see that constant's
 * comment for why this is an operational floor, not a safety one.
 */
export function computeDeterministicVerdict(
  category: FoodSafetyCategory,
  storageType: StorageType,
  expiryHours: number,
  wasHotHeld = false
): {
  verdict: FoodSafetyVerdict;
  ratio: number;
  safe_max_hours: number | null;
  insufficient_handling_time: boolean;
} {
  const safeMax = safeMaxHoursFor(category, storageType, wasHotHeld);

  if (category.requires_cold_chain && expiryHours < MINIMUM_HANDLING_HOURS) {
    return {
      verdict: 'bad',
      ratio: safeMax === null ? 0 : Number((expiryHours / safeMax).toFixed(2)),
      safe_max_hours: safeMax,
      insufficient_handling_time: true,
    };
  }

  if (safeMax === null) {
    return { verdict: 'good', ratio: 0, safe_max_hours: null, insufficient_handling_time: false };
  }

  const ratio = expiryHours / safeMax;
  const verdict: FoodSafetyVerdict = ratio <= 1 ? 'good' : ratio <= 2.5 ? 'warning' : 'bad';
  return { verdict, ratio: Number(ratio.toFixed(2)), safe_max_hours: safeMax, insufficient_handling_time: false };
}

/** AI may only escalate severity, never soften it — the deterministic ratio
 *  is the safety floor a hallucinated "looks fine" can't talk its way under. */
export function escalateOnly(floor: FoodSafetyVerdict, proposed: FoodSafetyVerdict): FoodSafetyVerdict {
  const rank: Record<FoodSafetyVerdict, number> = { good: 0, warning: 1, bad: 2 };
  return rank[proposed] > rank[floor] ? proposed : floor;
}
