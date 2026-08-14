import { haversine } from '@/lib/utils/geo';

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

function minutesFor(distanceKm: number): number {
  // Same road-speed assumption as fleet dispatch, plus a drop-off allowance.
  return Math.max(4, Math.round(distanceKm * 3 + 4));
}

function routeFrom(depot: RouteStop, order: RouteStop[]): Omit<OptimisedRoute, 'method' | 'permutations_considered'> {
  const legs: OptimisedRoute['legs'] = [];
  let total = 0;
  let cursor = depot;

  for (const stop of order) {
    const d = haversine(cursor.lat, cursor.lng, stop.lat, stop.lng);
    legs.push({
      from: cursor.name,
      to: stop.name,
      distance_km: Number(d.toFixed(2)),
      minutes: minutesFor(d),
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
 * Shortest delivery route from a branch through a set of partner stops.
 *
 * This is an open-ended route, not a round trip — the van finishes at its last
 * drop rather than returning to the branch, which is how these runs actually
 * work at the end of a shift.
 *
 * For up to 8 stops every ordering is evaluated, so the result is genuinely
 * optimal and `method` says `exact`. Beyond that it falls back to
 * nearest-neighbour and says `heuristic` — the distinction is reported rather
 * than glossed over, because "most efficient route" is only true when it is.
 */
export function optimiseRoute(depot: RouteStop, stops: RouteStop[]): OptimisedRoute {
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
    let best = routeFrom(depot, orderings[0]);
    for (let i = 1; i < orderings.length; i++) {
      const candidate = routeFrom(depot, orderings[i]);
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

  return { ...routeFrom(depot, order), method: 'heuristic', permutations_considered: stops.length };
}
