/**
 * Straight-line routing fallback (PRD §6: "Straight line distance is a fallback
 * approximation"). Travel time = haversine distance at `speedKmh` plus a fixed
 * drop-off allowance. Never claims live traffic.
 */
import { haversine } from '@/src/lib/geo';

export const DEFAULT_SPEED_KMH = 25;
/** Fixed stop/handover allowance in minutes. */
export const STOP_ALLOWANCE_MIN = 4;

export interface StraightLineOptions {
  /** Average road speed assumption (default 25 km/h for Jabodetabek). */
  speedKmh?: number;
}

export interface TravelEstimate {
  distance_km: number;
  minutes: number;
  source: 'STRAIGHT_LINE';
  confidence: 'LOW';
}

/** Single-leg estimate between two coordinates. */
export function estimateTravel(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  opts: StraightLineOptions = {},
): TravelEstimate {
  const d = haversine(from.lat, from.lng, to.lat, to.lng);
  return { distance_km: Number(d.toFixed(2)), minutes: minutesFor(d, opts.speedKmh), source: 'STRAIGHT_LINE', confidence: 'LOW' };
}

export interface RouteStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface OptimisedRoute {
  /** Stops in visiting order, starting from the depot (not included). */
  order: RouteStop[];
  legs: { from: string; to: string; distance_km: number; minutes: number }[];
  total_distance_km: number;
  total_minutes: number;
  /** 'exact' means every ordering was evaluated. 'heuristic' means it wasn't. */
  method: 'exact' | 'heuristic';
  /** How many orderings were considered — the honest measure of the claim. */
  permutations_considered: number;
}

/** Above this many stops, exhaustive search stops being cheap (8! = 40,320 is
 *  still trivial; 11! is 40 million). Real partner runs are 1–4 stops, so the
 *  exact path is the one that normally executes. */
const EXACT_LIMIT = 8;

export function minutesFor(distanceKm: number, speedKmh: number = DEFAULT_SPEED_KMH): number {
  if (!(speedKmh > 0)) throw new RangeError('speedKmh must be > 0');
  return Math.max(STOP_ALLOWANCE_MIN, Math.round((distanceKm / speedKmh) * 60 + STOP_ALLOWANCE_MIN));
}

function routeFrom(
  depot: RouteStop,
  order: RouteStop[],
  speedKmh: number,
): Omit<OptimisedRoute, 'method' | 'permutations_considered'> {
  const legs: OptimisedRoute['legs'] = [];
  let total = 0;
  let cursor = depot;

  for (const stop of order) {
    const d = haversine(cursor.lat, cursor.lng, stop.lat, stop.lng);
    legs.push({
      from: cursor.name,
      to: stop.name,
      distance_km: Number(d.toFixed(2)),
      minutes: minutesFor(d, speedKmh),
    });
    total += d;
    cursor = stop;
  }

  return {
    order,
    legs,
    total_distance_km: Number(total.toFixed(2)),
    total_minutes: legs.reduce((sum, l) => sum + l.minutes, 0),
  };
}

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permute(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

/**
 * Shortest delivery route from a source through a set of FLO stops.
 *
 * This is an open-ended route, not a round trip — the vehicle finishes at its
 * last drop rather than returning to the source.
 *
 * For up to 8 stops every ordering is evaluated, so the result is genuinely
 * optimal and `method` says `exact`. Beyond that it falls back to
 * nearest-neighbour and says `heuristic` — the distinction is reported rather
 * than glossed over, because "most efficient route" is only true when it is.
 */
export function optimiseRoute(depot: RouteStop, stops: RouteStop[], opts: StraightLineOptions = {}): OptimisedRoute {
  const speedKmh = opts.speedKmh ?? DEFAULT_SPEED_KMH;
  if (stops.length === 0) {
    return {
      order: [],
      legs: [],
      total_distance_km: 0,
      total_minutes: 0,
      method: 'exact',
      permutations_considered: 0,
    };
  }

  if (stops.length <= EXACT_LIMIT) {
    const orderings = permute(stops);
    let best = routeFrom(depot, orderings[0], speedKmh);
    for (let i = 1; i < orderings.length; i++) {
      const candidate = routeFrom(depot, orderings[i], speedKmh);
      if (candidate.total_distance_km < best.total_distance_km) best = candidate;
    }
    return { ...best, method: 'exact', permutations_considered: orderings.length };
  }

  // Nearest-neighbour: repeatedly hop to the closest unvisited stop.
  const remaining = [...stops];
  const order: RouteStop[] = [];
  let cursor = depot;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(cursor.lat, cursor.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    cursor = remaining[bestIdx];
    order.push(cursor);
    remaining.splice(bestIdx, 1);
  }

  return { ...routeFrom(depot, order, speedKmh), method: 'heuristic', permutations_considered: stops.length };
}
