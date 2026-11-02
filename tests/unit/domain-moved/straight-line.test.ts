import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPEED_KMH,
  estimateTravel,
  minutesFor,
  optimiseRoute,
  type RouteStop,
} from '@/src/adapters/routing/straight-line';

describe('straight-line travel time', () => {
  it('defaults to 25 km/h plus a 4 minute stop allowance', () => {
    expect(DEFAULT_SPEED_KMH).toBe(25);
    expect(minutesFor(10)).toBe(28); // 10km / 25km/h = 24 min + 4
    expect(minutesFor(0)).toBe(4);
  });

  it('is parametrised by speed', () => {
    expect(minutesFor(10, 50)).toBe(16);
    expect(() => minutesFor(10, 0)).toThrow(RangeError);
  });

  it('labels its estimate as a low-confidence straight-line fallback', () => {
    const e = estimateTravel({ lat: -6.14, lng: 106.86 }, { lat: -6.2, lng: 106.85 });
    expect(e.source).toBe('STRAIGHT_LINE');
    expect(e.confidence).toBe('LOW');
    expect(e.distance_km).toBeGreaterThan(6);
    expect(e.minutes).toBe(minutesFor(e.distance_km));
  });
});

describe('route optimisation', () => {
  const depot: RouteStop = { id: 'd', name: 'Sumber', lat: -6.14, lng: 106.86 };
  const stop = (id: string, lat: number, lng: number): RouteStop => ({ id, name: id, lat, lng });

  it('handles an empty stop list', () => {
    const r = optimiseRoute(depot, []);
    expect(r.order).toEqual([]);
    expect(r.total_distance_km).toBe(0);
  });

  it('produces one leg for a single stop', () => {
    const r = optimiseRoute(depot, [stop('a', -6.15, 106.87)]);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].from).toBe('Sumber');
    expect(r.method).toBe('exact');
  });

  it('finds the genuinely shortest ordering, not input order', () => {
    const near = stop('near', -6.145, 106.865);
    const far = stop('far', -6.2, 106.92);
    const r = optimiseRoute(depot, [far, near]);
    expect(r.order.map((s) => s.id)).toEqual(['near', 'far']);
    expect(r.permutations_considered).toBe(2);
  });

  it('is exhaustive up to 8 stops and heuristic beyond, and says so', () => {
    const four = Array.from({ length: 4 }, (_, i) => stop(`s${i}`, -6.14 - i * 0.02, 106.86 + i * 0.02));
    expect(optimiseRoute(depot, four).permutations_considered).toBe(24);
    const nine = Array.from({ length: 9 }, (_, i) => stop(`s${i}`, -6.14 - i * 0.01, 106.86 + i * 0.01));
    const r = optimiseRoute(depot, nine);
    expect(r.method).toBe('heuristic');
    expect(new Set(r.order.map((s) => s.id)).size).toBe(9);
  });

  it('uses the speed parameter for leg minutes', () => {
    const stops = [stop('a', -6.2, 106.86)];
    const slow = optimiseRoute(depot, stops, { speedKmh: 10 });
    const fast = optimiseRoute(depot, stops, { speedKmh: 60 });
    expect(slow.total_minutes).toBeGreaterThan(fast.total_minutes);
    expect(slow.total_distance_km).toBe(fast.total_distance_km);
  });
});
