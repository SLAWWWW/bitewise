import { describe, it, expect } from 'vitest';
import { haversine } from '@/lib/utils/geo';
import { calculateJainFairnessIndex } from '@/lib/algorithms/jain-fairness';
import { scoreBranches, excludedBranches, DEFAULT_MATCH_WEIGHTS, type MatchBranch } from '@/lib/algorithms/matching';

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

function branch(over: Partial<MatchBranch> & { id: string }): MatchBranch {
  return {
    name: `Branch ${over.id}`,
    lat: 1.3,
    lng: 103.8,
    current_load_kg: 0,
    capacity_kg: 100,
    color: '#fff',
    ...over,
  };
}

describe('haversine', () => {
  it('is zero for identical points', () => {
    expect(haversine(1.3521, 103.8198, 1.3521, 103.8198)).toBe(0);
  });

  it('is symmetric', () => {
    const a = haversine(1.3, 103.8, 1.45, 103.9);
    const b = haversine(1.45, 103.9, 1.3, 103.8);
    expect(a).toBeCloseTo(b, 10);
  });

  it('matches a known Singapore distance (Woodlands → Bukit Merah ≈ 17.6km)', () => {
    // Real seeded branch coordinates; ~17-18km apart in reality.
    const d = haversine(1.4382, 103.7891, 1.2819, 103.8239);
    expect(d).toBeGreaterThan(17);
    expect(d).toBeLessThan(18.5);
  });

  it('computes ~111km for one degree of latitude', () => {
    expect(haversine(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });
});

describe('calculateJainFairnessIndex', () => {
  it('returns 1 for a perfectly even distribution', () => {
    const branches = [
      { current_load_kg: 50, capacity_kg: 100 },
      { current_load_kg: 100, capacity_kg: 200 },
      { current_load_kg: 25, capacity_kg: 50 },
    ];
    // Every ratio is 0.5 — identical relative load despite different sizes.
    expect(calculateJainFairnessIndex(branches)).toBeCloseTo(1, 10);
  });

  it('approaches 1/n when load is concentrated in one branch', () => {
    const branches = [
      { current_load_kg: 100, capacity_kg: 100 },
      { current_load_kg: 0, capacity_kg: 100 },
      { current_load_kg: 0, capacity_kg: 100 },
      { current_load_kg: 0, capacity_kg: 100 },
    ];
    expect(calculateJainFairnessIndex(branches)).toBeCloseTo(0.25, 10);
  });

  it('is bounded to (0, 1] for arbitrary inputs', () => {
    const branches = [
      { current_load_kg: 371, capacity_kg: 500 },
      { current_load_kg: 320, capacity_kg: 400 },
      { current_load_kg: 428, capacity_kg: 600 },
      { current_load_kg: 263, capacity_kg: 350 },
      { current_load_kg: 373, capacity_kg: 450 },
    ];
    const j = calculateJainFairnessIndex(branches);
    expect(j).toBeGreaterThan(0);
    expect(j).toBeLessThanOrEqual(1);
  });

  it('handles an empty network and all-zero load without dividing by zero', () => {
    expect(calculateJainFairnessIndex([])).toBe(1);
    expect(
      calculateJainFairnessIndex([
        { current_load_kg: 0, capacity_kg: 100 },
        { current_load_kg: 0, capacity_kg: 200 },
      ])
    ).toBe(1);
  });

  it('treats a zero-capacity branch as ratio 0 rather than NaN', () => {
    const j = calculateJainFairnessIndex([
      { current_load_kg: 0, capacity_kg: 0 },
      { current_load_kg: 50, capacity_kg: 100 },
    ]);
    expect(Number.isNaN(j)).toBe(false);
  });
});

describe('scoreBranches', () => {
  const donor = { donorLat: 1.3, donorLng: 103.8 };

  it('excludes branches at or over capacity', () => {
    const branches = [
      branch({ id: 'full', current_load_kg: 100, capacity_kg: 100 }),
      branch({ id: 'over', current_load_kg: 120, capacity_kg: 100 }),
      branch({ id: 'ok', current_load_kg: 10, capacity_kg: 100 }),
    ];
    const scored = scoreBranches({ ...donor, foodType: 'bread', branches, existingInventory: [] });
    expect(scored.map((s) => s.branch.id)).toEqual(['ok']);
  });

  it('sorts results best-first', () => {
    const branches = [
      branch({ id: 'saturated', current_load_kg: 90, capacity_kg: 100 }),
      branch({ id: 'empty', current_load_kg: 0, capacity_kg: 100 }),
    ];
    const scored = scoreBranches({ ...donor, foodType: 'bread', branches, existingInventory: [] });
    expect(scored[0].branch.id).toBe('empty');
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  it('prefers the emptier branch when distance is equal (fairness dominates)', () => {
    const branches = [
      branch({ id: 'a', current_load_kg: 80, capacity_kg: 100 }),
      branch({ id: 'b', current_load_kg: 20, capacity_kg: 100 }),
    ];
    const scored = scoreBranches({ ...donor, foodType: 'bread', branches, existingInventory: [] });
    expect(scored[0].branch.id).toBe('b');
  });

  it('computes fairness_need as 1 - saturation', () => {
    const branches = [branch({ id: 'a', current_load_kg: 25, capacity_kg: 100 })];
    const [result] = scoreBranches({ ...donor, foodType: 'bread', branches, existingInventory: [] });
    expect(result.fairness_need).toBeCloseTo(0.75, 10);
  });

  it('computes proximity as 1 / (1 + distance*10)', () => {
    const branches = [branch({ id: 'a', lat: 1.3, lng: 103.8 })];
    const [result] = scoreBranches({ ...donor, foodType: 'bread', branches, existingInventory: [] });
    // Co-located: distance 0 → proximity 1.
    expect(result.distance_km).toBeCloseTo(0, 10);
    expect(result.proximity_score).toBeCloseTo(1, 10);
  });

  it('penalises a branch already holding the same food type expiring within 24h', () => {
    const branches = [branch({ id: 'a' })];
    const withGlut = scoreBranches({
      ...donor,
      foodType: 'bread',
      branches,
      existingInventory: [
        { branch_id: 'a', food_type: 'bread', expiry_at: hoursFromNow(4) },
        { branch_id: 'a', food_type: 'bread', expiry_at: hoursFromNow(10) },
      ],
    });
    expect(withGlut[0].same_type_expiring_soon).toBe(2);
    // 1 / (1 + 2*0.5) = 0.5
    expect(withGlut[0].spoilage_risk_score).toBeCloseTo(0.5, 10);
  });

  it('ignores a different food type, another branch, and items outside the 24h window', () => {
    const branches = [branch({ id: 'a' })];
    const [result] = scoreBranches({
      ...donor,
      foodType: 'bread',
      branches,
      existingInventory: [
        { branch_id: 'a', food_type: 'dairy', expiry_at: hoursFromNow(4) }, // wrong type
        { branch_id: 'b', food_type: 'bread', expiry_at: hoursFromNow(4) }, // wrong branch
        { branch_id: 'a', food_type: 'bread', expiry_at: hoursFromNow(48) }, // too far out
        { branch_id: 'a', food_type: 'bread', expiry_at: hoursFromNow(-2) }, // already expired
      ],
    });
    expect(result.same_type_expiring_soon).toBe(0);
    expect(result.spoilage_risk_score).toBeCloseTo(1, 10);
  });

  it('produces a total score equal to the documented weighted sum', () => {
    const branches = [branch({ id: 'a', lat: 1.3, lng: 103.8, current_load_kg: 40, capacity_kg: 100 })];
    const [r] = scoreBranches({ ...donor, foodType: 'bread', branches, existingInventory: [] });
    const expected =
      DEFAULT_MATCH_WEIGHTS.proximity * r.proximity_score +
      DEFAULT_MATCH_WEIGHTS.fairness * r.fairness_need +
      DEFAULT_MATCH_WEIGHTS.spoilage * r.spoilage_risk_score;
    expect(r.score).toBeCloseTo(expected, 10);
  });

  it('keeps every score within 0..1', () => {
    const branches = [
      branch({ id: 'a', lat: 1.44, lng: 103.79, current_load_kg: 1, capacity_kg: 500 }),
      branch({ id: 'b', lat: 1.28, lng: 103.82, current_load_kg: 499, capacity_kg: 500 }),
    ];
    const scored = scoreBranches({ ...donor, foodType: 'cooked', branches, existingInventory: [] });
    for (const s of scored) {
      for (const v of [s.score, s.proximity_score, s.fairness_need, s.spoilage_risk_score]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('returns an empty list when no branch has capacity', () => {
    const branches = [
      branch({ id: 'a', current_load_kg: 100, capacity_kg: 100 }),
      branch({ id: 'b', current_load_kg: 100, capacity_kg: 100 }),
    ];
    expect(scoreBranches({ ...donor, foodType: 'bread', branches, existingInventory: [] })).toEqual([]);
  });

  it('honours custom weights', () => {
    // Proximity-only weighting should pick the nearer branch even though it is fuller.
    const branches = [
      branch({ id: 'near-full', lat: 1.3, lng: 103.8, current_load_kg: 90, capacity_kg: 100 }),
      branch({ id: 'far-empty', lat: 1.45, lng: 103.95, current_load_kg: 0, capacity_kg: 100 }),
    ];
    const scored = scoreBranches({
      ...donor,
      foodType: 'bread',
      branches,
      existingInventory: [],
      weights: { proximity: 1, fairness: 0, spoilage: 0 },
    });
    expect(scored[0].branch.id).toBe('near-full');
  });
});

describe('excludedBranches', () => {
  it('returns exactly the at-capacity branches with a reason', () => {
    const branches = [
      branch({ id: 'full', current_load_kg: 100, capacity_kg: 100 }),
      branch({ id: 'ok', current_load_kg: 50, capacity_kg: 100 }),
    ];
    const excluded = excludedBranches(branches);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].branch.id).toBe('full');
    expect(excluded[0].reason).toBe('at_capacity');
  });

  it('partitions the network exactly with scoreBranches (no branch lost or double-counted)', () => {
    const branches = [
      branch({ id: 'a', current_load_kg: 100, capacity_kg: 100 }),
      branch({ id: 'b', current_load_kg: 10, capacity_kg: 100 }),
      branch({ id: 'c', current_load_kg: 200, capacity_kg: 100 }),
      branch({ id: 'd', current_load_kg: 0, capacity_kg: 100 }),
    ];
    const scored = scoreBranches({
      donorLat: 1.3,
      donorLng: 103.8,
      foodType: 'bread',
      branches,
      existingInventory: [],
    });
    const excluded = excludedBranches(branches);
    expect(scored.length + excluded.length).toBe(branches.length);
    const ids = [...scored.map((s) => s.branch.id), ...excluded.map((e) => e.branch.id)].sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});
