import type { FoodType } from '@/lib/types';

/**
 * The standardized food-safety rule corpus — every category a donated item
 * can be classified into, with the numbers a real safety verdict is computed
 * from (Section 7.7 of the PRD). This is the "documents" half of the
 * retrieval step: `retrieveFoodSafetyCategory()` (lib/algorithms/food-safety.ts)
 * picks the best-matching entry for whatever a donor actually typed, so the
 * verdict is grounded in the same reference no matter how the item was
 * worded — that's what makes scoring standardized across every submission
 * rather than dependent on which of 8 dropdown values a donor happened to
 * pick.
 *
 * Thresholds are anchored to two real published sources, not guessed:
 * - Singapore Food Agency, "Guidelines for Food Donation": chilled ≤4°C,
 *   frozen ≤-18°C, hot-held >60°C, and the 5°C–60°C temperature danger zone.
 * - FDA/USDA: perishable food unrefrigerated more than 2 hours is a discard
 *   risk, halved to 1 hour above 32°C / ~90°F — the realistic case here,
 *   since Singapore's ambient temperature sits above that line effectively
 *   year-round. `max_ambient_hours` on the high-risk perishable categories
 *   below (cooked meals, dairy, cream-filled bakery, thawed frozen) uses that
 *   1-hour figure rather than the temperate-climate 2-hour one; food-service
 *   guidance caps cumulative danger-zone time at 4 hours regardless.
 * `max_ambient_hours: null` means the category is shelf-stable — there is no
 * bacterial-risk clock running at room temperature, so no ambient time limit
 * applies (canned goods, dry goods, sealed beverages).
 */
export interface FoodSafetyCategory {
  key: string;
  label: string;
  perishable: boolean;
  /** True if this category is a real hazard once it exceeds max_ambient_hours at room temperature. */
  requires_cold_chain: boolean;
  max_ambient_hours: number | null;
  max_cold_hours: number | null;
  max_frozen_hours: number | null;
  safe_temp_note: string;
  /** Lowercase words matched against the donor's item name + note during retrieval. */
  keywords: string[];
  /** Which dropdown food_type values default to this category absent a stronger keyword match. */
  default_food_types: FoodType[];
}

export const FOOD_SAFETY_CATEGORIES: FoodSafetyCategory[] = [
  {
    key: 'cooked_high_risk',
    label: 'Cooked meat, poultry, seafood or mixed prepared meals',
    perishable: true,
    requires_cold_chain: true,
    max_ambient_hours: 1,
    max_cold_hours: 72,
    max_frozen_hours: 2160,
    safe_temp_note: 'Hot-held above 60°C, chilled at or below 4°C, or frozen at or below -18°C.',
    keywords: [
      'chicken', 'meat', 'beef', 'pork', 'lamb', 'fish', 'seafood', 'prawn', 'shrimp', 'crab',
      'curry', 'rice', 'noodle', 'noodles', 'pasta', 'soup', 'stew', 'gravy', 'buffet',
      'catering', 'cooked', 'meal', 'dish', 'bento', 'roast', 'fried', 'grilled', 'bbq',
    ],
    default_food_types: ['cooked'],
  },
  {
    key: 'dairy',
    label: 'Milk, yogurt, cheese, cream and other dairy',
    perishable: true,
    requires_cold_chain: true,
    max_ambient_hours: 1,
    max_cold_hours: 168,
    max_frozen_hours: 4320,
    safe_temp_note: 'Chilled at or below 4°C, or frozen at or below -18°C.',
    keywords: ['milk', 'yogurt', 'yoghurt', 'cheese', 'cream', 'dairy', 'butter', 'custard'],
    default_food_types: ['dairy'],
  },
  {
    key: 'cut_fresh_produce',
    label: 'Cut fruit, cut vegetables, salads, fresh-pressed juice',
    perishable: true,
    requires_cold_chain: true,
    max_ambient_hours: 4,
    max_cold_hours: 120,
    max_frozen_hours: null,
    safe_temp_note: 'Chilled at or below 4°C once cut, peeled, or juiced.',
    keywords: ['salad', 'cut fruit', 'cut vegetable', 'sliced', 'juice', 'smoothie', 'coleslaw'],
    default_food_types: [],
  },
  {
    key: 'whole_fresh_produce',
    label: 'Whole, uncut fruit and vegetables',
    perishable: true,
    requires_cold_chain: false,
    max_ambient_hours: 24,
    max_cold_hours: 240,
    max_frozen_hours: null,
    safe_temp_note: 'Ambient is acceptable short-term; chilled at or below 4°C extends shelf life.',
    keywords: ['fruit', 'vegetable', 'vegetables', 'produce', 'apple', 'banana', 'tomato', 'leafy'],
    default_food_types: ['produce'],
  },
  {
    key: 'bakery_plain',
    label: 'Bread, buns, and pastries without dairy or custard filling',
    perishable: true,
    requires_cold_chain: false,
    max_ambient_hours: 72,
    max_cold_hours: null,
    max_frozen_hours: 2160,
    safe_temp_note: 'Ambient storage is fine while dry; mould is the spoilage signal to watch, not bacteria.',
    keywords: ['bread', 'bun', 'loaf', 'baguette', 'roll', 'croissant', 'pastry', 'bakery', 'bagel'],
    default_food_types: ['bread'],
  },
  {
    key: 'bakery_dairy_filled',
    label: 'Cream cakes, custard pastries, and cream-filled desserts',
    perishable: true,
    requires_cold_chain: true,
    max_ambient_hours: 1,
    max_cold_hours: 72,
    max_frozen_hours: null,
    safe_temp_note: 'Chilled at or below 4°C — treat like dairy, not like plain bakery.',
    keywords: ['cream cake', 'cream puff', 'eclair', 'tiramisu', 'cheesecake', 'custard pastry'],
    default_food_types: [],
  },
  {
    key: 'eggs',
    label: 'Raw shell eggs',
    perishable: true,
    requires_cold_chain: false,
    max_ambient_hours: 24,
    max_cold_hours: 720,
    max_frozen_hours: null,
    safe_temp_note: 'Chilled at or below 4°C for extended storage; short ambient windows are acceptable.',
    keywords: ['egg', 'eggs'],
    default_food_types: [],
  },
  {
    key: 'frozen_prepared',
    label: 'Frozen meals, frozen meat, or frozen seafood, still frozen',
    perishable: true,
    requires_cold_chain: true,
    max_ambient_hours: 1,
    max_cold_hours: 72,
    max_frozen_hours: 4320,
    safe_temp_note: 'Frozen at or below -18°C. Once thawed, treat as cooked/high-risk (1-hour ambient limit in Singapore\'s climate).',
    keywords: ['frozen', 'ice cream'],
    default_food_types: [],
  },
  {
    key: 'canned_goods',
    label: 'Canned or jarred goods, unopened and undamaged',
    perishable: false,
    requires_cold_chain: false,
    max_ambient_hours: null,
    max_cold_hours: null,
    max_frozen_hours: null,
    safe_temp_note: 'Ambient storage indefinitely while sealed and undamaged — no bulging, rust-through, or leaks.',
    keywords: ['canned', 'can', 'tin', 'tinned', 'jar', 'jarred', 'preserved', 'bottled sauce'],
    default_food_types: ['canned'],
  },
  {
    key: 'dry_goods',
    label: 'Dry grains, rice, pasta, flour, cereal, dried beans',
    perishable: false,
    requires_cold_chain: false,
    max_ambient_hours: null,
    max_cold_hours: null,
    max_frozen_hours: null,
    safe_temp_note: 'Ambient storage for months while dry and pest-free — no refrigeration needed.',
    keywords: ['flour', 'cereal', 'dried', 'grain', 'grains', 'oats', 'beans', 'lentil', 'dry rice', 'dry pasta'],
    default_food_types: ['grain'],
  },
  {
    key: 'sealed_beverages',
    label: 'Sealed, shelf-stable beverages',
    perishable: false,
    requires_cold_chain: false,
    max_ambient_hours: null,
    max_cold_hours: null,
    max_frozen_hours: null,
    safe_temp_note: 'Ambient storage for long periods while sealed. Once opened, or if dairy-based/fresh-pressed, treat as dairy or cut produce instead.',
    keywords: ['bottled water', 'soda', 'soft drink', 'canned drink', 'juice box', 'beverage', 'drink'],
    default_food_types: ['beverage'],
  },
  {
    key: 'uncategorized',
    label: 'Uncategorized — conservative default',
    perishable: true,
    requires_cold_chain: true,
    max_ambient_hours: 4,
    max_cold_hours: 96,
    max_frozen_hours: null,
    safe_temp_note: 'No confident category match — defaulting to a conservative perishable assumption until reviewed.',
    keywords: [],
    default_food_types: ['other'],
  },
];

export function findCategoryByKey(key: string): FoodSafetyCategory | undefined {
  return FOOD_SAFETY_CATEGORIES.find((c) => c.key === key);
}

function categoryForFoodType(foodType: FoodType): FoodSafetyCategory {
  return (
    FOOD_SAFETY_CATEGORIES.find((c) => c.default_food_types.includes(foodType)) ??
    FOOD_SAFETY_CATEGORIES.find((c) => c.key === 'uncategorized')!
  );
}

/** Plain-language guidance for a fixed food_type value — for call sites that
 *  only have the dropdown value, not a free-text item name, to retrieve
 *  against (the public storage-handling note on `/api/inventory`, and the
 *  Supply Chain Planner Agent's prompt). Where a real item name is
 *  available, prefer `retrieveFoodSafetyCategory()` instead — it can find a
 *  more specific category than the dropdown's own default. */
export function guidelineForFoodType(foodType: FoodType): string {
  const c = categoryForFoodType(foodType);
  const ambient = c.max_ambient_hours === null ? 'no meaningful limit while sealed and dry' : `about ${c.max_ambient_hours}h`;
  return `${c.label}. ${c.perishable ? 'Perishable' : 'Shelf-stable'}${c.requires_cold_chain ? ', requires cold chain' : ''}. Safe ambient window: ${ambient}. ${c.safe_temp_note}`;
}
