import { describe, it, expect } from 'vitest';
import { haversine } from '@/src/lib/geo';

describe('haversine', () => {
  it('is zero for identical points', () => {
    expect(haversine(-6.1384, 106.8638, -6.1384, 106.8638)).toBe(0);
  });

  it('is symmetric', () => {
    const a = haversine(-6.2, 106.8, -6.35, 106.9);
    const b = haversine(-6.35, 106.9, -6.2, 106.8);
    expect(a).toBeCloseTo(b, 10);
  });

  it('computes ~111km for one degree of latitude', () => {
    expect(haversine(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it('matches a known Jabodetabek distance (Monas → Bogor ≈ 43km straight line)', () => {
    const d = haversine(-6.1754, 106.8272, -6.5971, 106.806);
    expect(d).toBeGreaterThan(45);
    expect(d).toBeLessThan(48);
  });
});
