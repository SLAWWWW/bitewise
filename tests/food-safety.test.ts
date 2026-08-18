import { describe, it, expect } from 'vitest';
import { retrieveFoodSafetyCategory, computeDeterministicVerdict, escalateOnly } from '@/lib/algorithms/food-safety';
import { findCategoryByKey } from '@/lib/knowledge/food-safety';

describe('retrieveFoodSafetyCategory', () => {
  it('matches a high-risk category by keyword even when food_type is generic', () => {
    const { category } = retrieveFoodSafetyCategory('Roast Chicken', 'other');
    expect(category.key).toBe('cooked_high_risk');
  });

  it('matches canned goods by keyword regardless of declared food_type', () => {
    const { category } = retrieveFoodSafetyCategory('Canned Baked Beans', 'other');
    expect(category.key).toBe('canned_goods');
  });

  it('falls back to the declared food_type default when no keyword matches', () => {
    const { category, matched_keywords } = retrieveFoodSafetyCategory('Widget XYZ-9000', 'dairy');
    expect(category.key).toBe('dairy');
    expect(matched_keywords).toHaveLength(0);
  });

  it('falls back to the conservative uncategorized default for food_type "other" with no keyword match', () => {
    const { category } = retrieveFoodSafetyCategory('Mystery Item', 'other');
    expect(category.key).toBe('uncategorized');
  });

  it('prefers the more specific match when the note contains a stronger signal than the item name', () => {
    const { category } = retrieveFoodSafetyCategory('Lunch box', 'other', 'chicken rice with gravy');
    expect(category.key).toBe('cooked_high_risk');
  });

  it('breaks a keyword-count tie between canned goods and fresh produce using the declared food_type', () => {
    // "Canned Vegetables" scores 2 keyword hits on both canned_goods
    // ('canned', 'can') and whole_fresh_produce ('vegetable', 'vegetables') —
    // the donor's own food_type selection should decide, not array order.
    const canned = retrieveFoodSafetyCategory('Canned Vegetables', 'canned');
    expect(canned.category.key).toBe('canned_goods');

    const produce = retrieveFoodSafetyCategory('Canned Vegetables', 'produce');
    expect(produce.category.key).toBe('whole_fresh_produce');
  });
});

describe('computeDeterministicVerdict', () => {
  const cookedHighRisk = findCategoryByKey('cooked_high_risk')!;
  const cannedGoods = findCategoryByKey('canned_goods')!;

  it('is good when chilled within the safe cold window', () => {
    const v = computeDeterministicVerdict(cookedHighRisk, 'cold', 24);
    expect(v.verdict).toBe('good');
    expect(v.ratio).toBeLessThanOrEqual(1);
  });

  it('is exactly at the boundary (ratio 1.0) and still counts as good, not warning', () => {
    const v = computeDeterministicVerdict(cookedHighRisk, 'ambient', 1); // max_ambient_hours = 1 (Singapore's climate halves the temperate 2h rule)
    expect(v.ratio).toBe(1);
    expect(v.verdict).toBe('good');
  });

  it('is a warning when moderately over the safe ambient window', () => {
    const v = computeDeterministicVerdict(cookedHighRisk, 'ambient', 1.5); // 1.5x of 1h
    expect(v.verdict).toBe('warning');
  });

  it('is exactly at the warning/bad boundary (ratio 2.5) and still counts as warning', () => {
    const v = computeDeterministicVerdict(cookedHighRisk, 'ambient', 2.5); // 2.5x of 1h
    expect(v.ratio).toBe(2.5);
    expect(v.verdict).toBe('warning');
  });

  it('is bad when grossly over the safe ambient window — cooked chicken declared safe for 2 days', () => {
    const v = computeDeterministicVerdict(cookedHighRisk, 'ambient', 48); // 48x of 1h
    expect(v.verdict).toBe('bad');
  });

  it('is always good for shelf-stable categories regardless of declared expiry window', () => {
    const v = computeDeterministicVerdict(cannedGoods, 'ambient', 8760); // 1 year
    expect(v.verdict).toBe('good');
    expect(v.safe_max_hours).toBeNull();
    expect(v.ratio).toBe(0);
  });
});

describe('escalateOnly', () => {
  it('lets the AI escalate a good floor to warning', () => {
    expect(escalateOnly('good', 'warning')).toBe('warning');
  });

  it('lets the AI escalate a warning floor to bad', () => {
    expect(escalateOnly('warning', 'bad')).toBe('bad');
  });

  it('never lets the AI soften a bad floor down to good', () => {
    expect(escalateOnly('bad', 'good')).toBe('bad');
  });

  it('never lets the AI soften a warning floor down to good', () => {
    expect(escalateOnly('warning', 'good')).toBe('warning');
  });

  it('keeps the floor when the AI agrees exactly', () => {
    expect(escalateOnly('good', 'good')).toBe('good');
  });
});
