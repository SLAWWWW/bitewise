/**
 * Seed configuration, deterministic ids and time helpers (architecture B).
 *
 * Rules for everything under db/seed/**:
 *  - no Math.random, no Date.now, no argument-less `new Date()`, no gen_random_uuid:
 *    randomness comes from `streamFor(seed, label)` and time from the configured clock;
 *  - every id is uuidv5(`${entity}:${naturalKey}`, tenantNamespace(slug)).
 *
 * Asia/Jakarta has no DST; local-date conversions still go through src/lib/tz so the
 * machine time zone (+08 here, UTC in tests) never matters.
 */
import { streamFor, type Rng } from '@/src/lib/prng';
import { entityId, tenantNamespace } from '@/src/lib/uuidv5';
import { addLocalDays, localDate, startOfLocalDay } from '@/src/lib/tz';

export interface SeedConfig {
  slug: string;
  name: string;
  mode: 'DEMO' | 'TEST';
  seed: number;
  /** Simulated clock instant (ISO). Default 2026-10-26T01:00:00Z = Mon 08:00 WIB. */
  clock: string;
  timezone: string;
}

export const DEFAULT_SEED_CONFIG: SeedConfig = {
  slug: 'foodcycle-demo',
  name: 'FoodCycle Demo',
  mode: 'DEMO',
  seed: 20261026,
  clock: '2026-10-26T01:00:00Z',
  timezone: 'Asia/Jakarta',
};

export function resolveConfig(partial: Partial<SeedConfig> = {}): SeedConfig {
  const cfg = { ...DEFAULT_SEED_CONFIG, ...partial };
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(cfg.slug)) throw new Error(`Invalid tenant slug: ${cfg.slug}`);
  if (cfg.mode !== 'DEMO' && cfg.mode !== 'TEST') throw new Error('The seed only creates DEMO/TEST tenants');
  if (!Number.isInteger(cfg.seed)) throw new Error('seed must be an integer');
  if (Number.isNaN(new Date(cfg.clock).getTime())) throw new Error(`Invalid clock: ${cfg.clock}`);
  return cfg;
}

/** True when the config produces the committed expected manifest (seed + clock). */
export function isCanonicalRun(cfg: SeedConfig): boolean {
  return cfg.seed === DEFAULT_SEED_CONFIG.seed && msOf(cfg.clock) === msOf(DEFAULT_SEED_CONFIG.clock);
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------
export class Ids {
  readonly ns: string;
  readonly tenantId: string;
  constructor(readonly slug: string) {
    this.ns = tenantNamespace(slug);
    // Same convention as tests/setup/db-helpers.makeTenant.
    this.tenantId = entityId(this.ns, 'tenant', slug);
  }
  id(entity: string, naturalKey: string): string {
    return entityId(this.ns, entity, naturalKey);
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function msOf(iso: string): number {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) throw new RangeError(`Invalid instant ${iso}`);
  return ms;
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export class Clock {
  readonly now: number;
  readonly today: string;
  constructor(
    readonly cfg: SeedConfig,
  ) {
    this.now = msOf(cfg.clock);
    this.today = localDate(this.now, cfg.timezone);
  }
  get tz(): string {
    return this.cfg.timezone;
  }
  /** Local date (YYYY-MM-DD) of an instant in the tenant zone. */
  dateOf(ms: number): string {
    return localDate(ms, this.cfg.timezone);
  }
  /** Instant of local `date` at hh:mm (+ extra minutes). */
  at(date: string, hh: number, mm = 0): number {
    return startOfLocalDay(date, this.cfg.timezone).getTime() + hh * HOUR + mm * MIN;
  }
  dayStart(date: string): number {
    return startOfLocalDay(date, this.cfg.timezone).getTime();
  }
  addDays(date: string, days: number): string {
    return addLocalDays(date, days);
  }
  /** Minutes since local midnight of an instant. */
  minuteOfDay(ms: number): number {
    return Math.floor((ms - this.dayStart(this.dateOf(ms))) / MIN);
  }
  /**
   * Calendar H+1 rule (PRD REP02): due = end of the next local day, stored as
   * 23:59:59.999999 local. Returns the ISO text (microsecond precision) and the
   * exclusive bound in ms (submitted_at < exclusiveMs ⇔ submitted_at <= due).
   */
  dueCalendar(anchorMs: number): { iso: string; exclusiveMs: number } {
    const exclusiveMs = this.dayStart(this.addDays(this.dateOf(anchorMs), 2));
    const text = iso(exclusiveMs - 1).replace(/\.(\d{3})Z$/, '.$1999Z');
    return { iso: text, exclusiveMs };
  }
  /**
   * Add `minutes` of contact time (default window 08:00–20:00 local, every day).
   * Out-of-hours time does not count (PRD §8 responsiveness).
   */
  addContactMinutes(startMs: number, minutes: number, fromHour = 8, toHour = 20): number {
    let t = startMs;
    let left = minutes;
    for (let guard = 0; guard < 400; guard++) {
      const date = this.dateOf(t);
      const open = this.at(date, fromHour);
      const close = this.at(date, toHour);
      if (t < open) t = open;
      if (t >= close) {
        t = this.at(this.addDays(date, 1), fromHour);
        continue;
      }
      const avail = Math.floor((close - t) / MIN);
      if (left <= avail) return t + left * MIN;
      left -= avail;
      t = this.at(this.addDays(date, 1), fromHour);
    }
    throw new Error('addContactMinutes: runaway loop');
  }
}

// ---------------------------------------------------------------------------
// Random helpers on top of src/lib/prng (all deterministic per stream label)
// ---------------------------------------------------------------------------
export class Streams {
  private cache = new Map<string, Rng>();
  constructor(readonly seed: number) {}
  get(label: string): Rng {
    let r = this.cache.get(label);
    if (!r) {
      r = streamFor(this.seed, label);
      this.cache.set(label, r);
    }
    return r;
  }
}

export function intIn(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Weighted pick; weights must be >= 0 with a positive sum. */
export function weightedPick<T>(rng: Rng, items: readonly T[], weight: (t: T) => number): T {
  let total = 0;
  for (const it of items) total += weight(it);
  if (!(total > 0)) throw new Error('weightedPick: empty or zero-weight candidate set');
  let u = rng() * total;
  for (const it of items) {
    u -= weight(it);
    if (u < 0) return it;
  }
  return items[items.length - 1];
}

/** Weighted sample without replacement (Efraimidis–Spirakis keys), stable on ties. */
export function weightedSample<T>(rng: Rng, items: readonly T[], k: number, weight: (t: T) => number): T[] {
  const keyed = items.map((it, i) => {
    const w = weight(it);
    const u = rng();
    return { it, i, key: w > 0 ? Math.log(u === 0 ? Number.MIN_VALUE : u) / w : -Infinity };
  });
  keyed.sort((a, b) => (b.key - a.key) || (a.i - b.i));
  return keyed.slice(0, k).map((x) => x.it);
}

export const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** 'YYYY-MM-DD' → 'YYMMDD' */
export const yymmdd = (date: string) => date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
