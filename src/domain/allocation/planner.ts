import { demandOverHorizon, type CategoryDemand } from '@/src/domain/flo/demand';
import type { ServiceSchedule } from '@/src/domain/flo/schedule';
import type { DatedWindow } from '@/src/domain/flo/hours';
import { floorToIncrement, formatQty, minQ, parseDbQty, ratio } from '@/src/lib/qty';

export type Factors = Record<'N' | 'F' | 'L' | 'R' | 'E', number>;
export interface Candidate {
  id: string; code: string; name: string; reasons: string[];
  travel: { minutes: number; distance_km: number; source: string };
  same_cluster: boolean; capacity: string | null;
  need: { score: number; assessed_at: string; expires_at: string } | null;
  schedules: ServiceSchedule[]; demands: CategoryDemand[]; closures: DatedWindow[];
  received: string; received_7: string; received_30: string; committed: string; last_received: string | null;
  responses: { opportunities: number; timely: number };
  reporting: { type: 'BAST' | 'RECEIPT_PHOTO' | 'DISTRIBUTION'; state: string; due_at: string; timeliness: string | null }[];
}
export interface FeatureSnapshot {
  item_id: string; item_revision: number; policy_id: string;
  policy: { weights: Factors; max_travel_minutes: Record<string, number>; min_useful_qty: Record<string, { qty: string; unit: string }>; wave_size: number };
  now: string; timezone: string; planning_date: string; service_date: string;
  horizon_start: string; horizon_end: string; from_date: string; to_date_excl: string;
  receipt_at: string; distribution_at: string; quantity: string; available: string; unit: string; category: string; increment: string;
  candidates: Candidate[];
}
export interface RankedCandidate {
  flo_id: string; code: string; name: string; score: number; factors: Factors;
  coverage: number | null; recency: number; demand: string | null; capacity: string;
  received_7: string; received_30: string; committed: string;
  response_samples: number; reporting_samples: number; flags: string[];
  travel: Candidate['travel']; same_cluster: boolean;
}
export interface Plan {
  selected: (RankedCandidate & { quantity: string })[];
  alternatives: RankedCandidate[];
  excluded: { flo_id: string; code: string; name: string; reasons: string[] }[];
  unallocated_quantity: string;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function weightedScore(factors: Factors, weights: Factors): number {
  const keys = ['N', 'F', 'L', 'R', 'E'] as const;
  if (keys.some(k => !Number.isFinite(weights[k]) || weights[k] < 0 || !Number.isFinite(factors[k]) || factors[k] < 0 || factors[k] > 1)
      || Math.abs(keys.reduce((s,k) => s + weights[k], 0) - 1) > 1e-9) throw new RangeError('Invalid factors or weights');
  return 100 * keys.reduce((s,k) => s + factors[k] * weights[k], 0);
}

export function rankCandidate(c: Candidate, s: FeatureSnapshot): RankedCandidate {
  const flags: string[] = [];
  const now = Date.parse(s.now);
  const needFresh = c.need && Date.parse(c.need.expires_at) > now && now - Date.parse(c.need.assessed_at) <= 30 * 86400000;
  const N = needFresh ? Number(c.need!.score) / 100 : 0.5;
  if (!needFresh) flags.push(c.need ? 'NEED_STALE' : 'NEED_MISSING');
  const demand = demandOverHorizon({ schedules: c.schedules, demands: c.demands, closures: c.closures,
    fromDate: s.from_date, toDateExcl: s.to_date_excl, unit: s.unit, tz: s.timezone });
  const received = parseDbQty(c.received), committed = parseDbQty(c.committed);
  const coverage = demand.value != null && demand.value > 0n ? ratio(received + committed, demand.value) : null;
  if (coverage == null) flags.push('DEMAND_UNKNOWN', ...demand.flags);
  let recency = c.last_received ? clamp((now - Date.parse(c.last_received)) / (30 * 86400000)) : 0.5;
  if (!c.last_received) flags.push('HISTORY_UNKNOWN');
  if (committed > 0n) recency = Math.min(recency, 0.5);
  const F = 0.7 * (coverage == null ? 0.5 : 1 - clamp(coverage)) + 0.3 * recency;
  const maxMinutes = s.policy.max_travel_minutes[s.category];
  if (!(maxMinutes > 0)) throw new RangeError('Travel policy is missing');
  const L = 0.7 * clamp(1 - c.travel.minutes / maxMinutes) + 0.3 * 0.5;
  const R = (c.responses.timely + 2) / (c.responses.opportunities + 4);
  let reportingSamples = 0;
  const performance = (type: Candidate['reporting'][number]['type']) => {
    let sum = 0, count = 0;
    for (const o of c.reporting) {
      if (o.type !== type || ['EXCUSED', 'SUBMITTED', 'UNDER_REVIEW'].includes(o.state)) continue;
      if (o.state === 'ACCEPTED') { sum += o.timeliness === 'ON_TIME' ? 1 : 0.5; count++; }
      else if (o.state === 'REJECTED_FINAL' || Date.parse(o.due_at) < now) count++;
    }
    reportingSamples += count;
    return (sum + 2) / (count + 4);
  };
  const E = 0.4 * performance('BAST') + 0.3 * performance('RECEIPT_PHOTO') + 0.3 * performance('DISTRIBUTION');
  const factors = { N, F, L, R, E };
  return { flo_id: c.id, code: c.code, name: c.name, score: weightedScore(factors, s.policy.weights), factors,
    coverage, recency, demand: demand.value == null ? null : formatQty(demand.value), capacity: c.capacity ?? '0',
    received_7: c.received_7, received_30: c.received_30, committed: c.committed,
    response_samples: c.responses.opportunities, reporting_samples: reportingSamples,
    flags: [...new Set(flags)], travel: c.travel, same_cluster: c.same_cluster };
}

/** All quantity arithmetic is exact. Cluster/distance bands are expanded in order;
 * ranking inside a band never uses organisation name or FLO type. */
export function planAllocation(s: FeatureSnapshot): Plan {
  const result: Plan = { selected: [], alternatives: [], excluded: [], unallocated_quantity: s.available };
  let remaining = parseDbQty(s.available);
  const increment = parseDbQty(s.increment);
  const useful = s.policy.min_useful_qty[s.category];
  const minimum = useful?.unit === s.unit ? parseDbQty(useful.qty) : increment;
  const candidates: RankedCandidate[] = [];
  for (const c of s.candidates) {
    const reasons = [...c.reasons];
    if (c.capacity == null) reasons.push('CAPACITY_UNKNOWN');
    else if (parseDbQty(c.capacity) < minimum) reasons.push('BELOW_MIN_USEFUL');
    if (reasons.length) result.excluded.push({ flo_id: c.id, code: c.code, name: c.name, reasons: [...new Set(reasons)] });
    else candidates.push(rankCandidate(c, s));
  }
  const band = (c: RankedCandidate) => c.same_cluster ? 0 : c.travel.distance_km <= 5 ? 1 : c.travel.distance_km <= 10 ? 2 : 3;
  candidates.sort((a,b) => band(a)-band(b) || b.score-a.score || (a.coverage ?? 0.5)-(b.coverage ?? 0.5)
    || b.recency-a.recency || a.travel.minutes-b.travel.minutes || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const c of candidates) {
    const quantity = floorToIncrement(minQ(remaining, parseDbQty(c.capacity)), increment);
    if (quantity < minimum || result.selected.length >= Math.min(3, s.policy.wave_size)) { result.alternatives.push(c); continue; }
    result.selected.push({ ...c, quantity: formatQty(quantity) });
    remaining -= quantity;
    // Each FLO appears once. Its commitment replaces the proposed quantity on
    // the next run; recipients are never selected repeatedly within one wave.
  }
  result.unallocated_quantity = formatQty(remaining);
  return result;
}
