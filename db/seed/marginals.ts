/**
 * Exact marginals (PRD §24) as shuffled label multisets, then named fixtures enforced
 * by swaps that preserve every multiset (architecture B.2).
 */
import { shuffle, type Rng } from '@/src/lib/prng';

export const AREA_COUNTS = { JAKARTA: 70, BOGOR: 35, DEPOK: 25, TANGERANG: 40, BEKASI: 30 } as const;
export const TYPE_COUNTS = { PANTI: 110, NON_PANTI: 90 } as const;
export const PEOPLE_BAND_COUNTS = { B10_30: 50, B31_80: 80, B81_200: 50, B201_500: 20 } as const;
export const AGREEMENT_COUNTS = { ACTIVE_GT30: 140, EXPIRING: 25, EXPIRED: 25, PENDING: 10 } as const;
export const CONTACT_COUNTS = { FAST: 70, ORDINARY: 70, SLOW: 40, UNKNOWN: 20 } as const;
export const REPORTING_COUNTS = { GOOD: 90, MIXED: 60, POOR: 30, INSUFFICIENT: 20 } as const;
export const TENURE_COUNTS = { NEW: 20, ESTABLISHED: 180 } as const;

export const PEOPLE_BANDS: Record<PeopleBand, [number, number]> = {
  B10_30: [10, 30],
  B31_80: [31, 80],
  B81_200: [81, 200],
  B201_500: [201, 500],
};

export type Area = keyof typeof AREA_COUNTS;
export type FloTypeLabel = keyof typeof TYPE_COUNTS;
export type PeopleBand = keyof typeof PEOPLE_BAND_COUNTS;
export type AgreementClass = keyof typeof AGREEMENT_COUNTS;
export type ContactProfile = keyof typeof CONTACT_COUNTS;
export type ReportingProfile = keyof typeof REPORTING_COUNTS;
export type Tenure = keyof typeof TENURE_COUNTS;

export const FLO_COUNT = 200;

/** Ordered multiset from exact counts (key order = insertion order of `counts`). */
export function labelMultiset<K extends string>(counts: Readonly<Record<K, number>>): K[] {
  const out: K[] = [];
  for (const k of Object.keys(counts) as K[]) for (let i = 0; i < counts[k]; i++) out.push(k);
  return out;
}

export function countBy<T, K extends string | number>(xs: readonly T[], key: (x: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const x of xs) {
    const k = key(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function sameMultiset<K extends string>(xs: readonly K[], counts: Readonly<Record<K, number>>): boolean {
  const got = countBy(xs, (x) => x);
  const keys = new Set<string>([...Object.keys(got), ...Object.keys(counts)]);
  for (const k of keys) if ((got[k as K] ?? 0) !== (counts[k as K] ?? 0)) return false;
  return true;
}

export interface FixtureRequirement<V> {
  index: number;
  /** Does value v satisfy the fixture? (exact value or partial tuple match) */
  matches: (v: V) => boolean;
  label: string;
}

/**
 * Enforce fixture requirements on one attribute array by swapping with the lowest
 * non-fixture index whose value satisfies the requirement. Swaps preserve the
 * multiset. Throws when no donor value exists (pre-assert failure).
 */
export function enforceBySwap<V>(arr: V[], reqs: readonly FixtureRequirement<V>[], fixtureIdx: ReadonlySet<number>): void {
  for (const r of reqs) {
    if (r.matches(arr[r.index])) continue;
    let g = -1;
    for (let i = 0; i < arr.length; i++) {
      if (fixtureIdx.has(i)) continue;
      if (r.matches(arr[i])) {
        g = i;
        break;
      }
    }
    if (g < 0) throw new Error(`Fixture requirement cannot be met by a swap: ${r.label}`);
    const tmp = arr[r.index];
    arr[r.index] = arr[g];
    arr[g] = tmp;
  }
}

/** Shuffled exact multiset on its own stream. */
export function shuffledMarginal<K extends string>(rng: Rng, counts: Readonly<Record<K, number>>): K[] {
  const arr = shuffle(labelMultiset(counts), rng);
  if (arr.length !== FLO_COUNT) throw new Error('marginal size must be 200');
  return arr;
}

export interface TenureTuple {
  tenure: Tenure;
  contact: ContactProfile;
  reporting: ReportingProfile;
}

/**
 * Joint tenure tuples: NEW → (UNKNOWN, INSUFFICIENT) ×20; established get shuffled
 * contact (fast 70 / ordinary 70 / slow 40) and reporting (good 90 / mixed 60 /
 * poor 30) pairs. Then the tuple list is shuffled. All marginals stay exact.
 */
export function tenureTuples(contactRng: Rng, reportingRng: Rng, tupleRng: Rng): TenureTuple[] {
  const contacts = shuffle(labelMultiset({ FAST: 70, ORDINARY: 70, SLOW: 40 } as const), contactRng);
  const reports = shuffle(labelMultiset({ GOOD: 90, MIXED: 60, POOR: 30 } as const), reportingRng);
  const tuples: TenureTuple[] = [];
  for (let i = 0; i < 20; i++) tuples.push({ tenure: 'NEW', contact: 'UNKNOWN', reporting: 'INSUFFICIENT' });
  for (let i = 0; i < 180; i++) tuples.push({ tenure: 'ESTABLISHED', contact: contacts[i], reporting: reports[i] });
  return shuffle(tuples, tupleRng);
}
