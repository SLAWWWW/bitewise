import { describe, it, expect } from 'vitest';
import { jainDiagnostic, jainIndex } from '@/src/domain/allocation/jain';

describe('jainIndex', () => {
  it('returns 1 for a perfectly even distribution', () => {
    expect(jainIndex([0.5, 0.5, 0.5])).toBeCloseTo(1, 10);
  });

  it('is 1/n when everything is concentrated in one partner', () => {
    expect(jainIndex([1, 0, 0, 0])).toBeCloseTo(0.25, 10);
  });

  it('is bounded to [1/n, 1] for arbitrary inputs', () => {
    const xs = [0.742, 0.8, 0.713, 0.751, 0.829];
    const j = jainIndex(xs)!;
    expect(j).toBeGreaterThanOrEqual(1 / xs.length);
    expect(j).toBeLessThanOrEqual(1);
  });

  it('is undefined (null) for an empty cohort or all zeros — no divide by zero', () => {
    expect(jainIndex([])).toBeNull();
    expect(jainIndex([0, 0])).toBeNull();
  });

  it('rejects negative or non-finite inputs', () => {
    expect(() => jainIndex([0.5, -0.1])).toThrow(RangeError);
    expect(() => jainIndex([Number.NaN])).toThrow(RangeError);
  });
});

describe('jainDiagnostic (AC47)', () => {
  it('reports NO_DISTRIBUTION when every coverage is zero', () => {
    expect(jainDiagnostic([0, 0, 0])).toEqual({ status: 'NO_DISTRIBUTION', n: 3 });
  });

  it('reports INSUFFICIENT_COHORT below two partners', () => {
    expect(jainDiagnostic([0.4])).toEqual({ status: 'INSUFFICIENT_COHORT', n: 1 });
    expect(jainDiagnostic([])).toEqual({ status: 'INSUFFICIENT_COHORT', n: 0 });
  });

  it('caps coverage at 1 before computing', () => {
    const r = jainDiagnostic([2, 1]);
    expect(r).toEqual({ status: 'OK', index: 1, n: 2 });
  });
});
