/**
 * Service schedules (PRD §5/§7, architecture A.1 `service_schedules`, C "Horizon").
 *
 * - A schedule row is effective on local dates [effective_from, effective_to_excl).
 * - Count bases (DAILY_RESIDENTS | PER_EVENT | WEEKLY_REACH) are different measures and
 *   are never added together as if they were unique people. Each row stands alone.
 * - Per local date and count basis, the effective row is the one with the latest
 *   effective_from (ties: lowest id). This makes a schedule change mid-horizon use the
 *   schedule in force on each date, never today's headcount for the whole past.
 * - Two different count bases effective on the same date is an ambiguity the caller must
 *   surface (MIXED_COUNT_BASIS), not resolve by summing.
 */
import { DEFAULT_TZ, addLocalDays, type Instant } from '@/src/lib/tz';
import { isDateFullyBlocked, isoDow, type DatedWindow } from './hours';

import { COUNT_BASES, type CountBasis } from '@/src/shared/enums';
export { COUNT_BASES, type CountBasis };

export interface ServiceSchedule {
  id: string;
  /** Local date 'YYYY-MM-DD', inclusive. */
  effective_from: string;
  /** Local date 'YYYY-MM-DD', exclusive; null = open-ended. */
  effective_to_excl: string | null;
  /** ISO days of week, Monday = 1 … Sunday = 7. */
  service_dows: readonly number[];
  people_per_event: number;
  count_basis: CountBasis;
  declared_count?: number | null;
  verified_count?: number | null;
  verified_at?: Instant | null;
}

export interface ServiceEvent {
  date: string;
  schedule_id: string;
  count_basis: CountBasis;
  people: number;
  verified: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(d: string, what: string): void {
  if (!DATE_RE.test(d)) throw new RangeError(`Invalid ${what}: ${d}`);
}

/** effective_from <= date < effective_to_excl (null = open-ended). */
export function scheduleEffectiveOn(s: ServiceSchedule, date: string): boolean {
  return s.effective_from <= date && (s.effective_to_excl == null || date < s.effective_to_excl);
}

const latestFirst = (a: ServiceSchedule, b: ServiceSchedule): number =>
  a.effective_from > b.effective_from ? -1 : a.effective_from < b.effective_from ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Effective schedule per count basis on `date` (latest effective_from wins within a basis).
 * Returned in COUNT_BASES order; length > 1 means mixed bases on that date.
 */
export function effectiveSchedulesOn(schedules: readonly ServiceSchedule[], date: string): ServiceSchedule[] {
  assertDate(date, 'date');
  const out: ServiceSchedule[] = [];
  for (const basis of COUNT_BASES) {
    const s = schedules.filter((x) => x.count_basis === basis && scheduleEffectiveOn(x, date)).sort(latestFirst)[0];
    if (s) out.push(s);
  }
  return out;
}

/** The single effective schedule for `date` and `basis`, or null. */
export function resolveSchedule(
  schedules: readonly ServiceSchedule[],
  date: string,
  basis: CountBasis,
): ServiceSchedule | null {
  return effectiveSchedulesOn(schedules, date).find((s) => s.count_basis === basis) ?? null;
}

/** Local dates in [fromDate, toDateExcl). */
export function localDateRange(fromDate: string, toDateExcl: string): string[] {
  assertDate(fromDate, 'fromDate');
  assertDate(toDateExcl, 'toDateExcl');
  const out: string[] = [];
  for (let d = fromDate; d < toDateExcl; d = addLocalDays(d, 1)) out.push(d);
  return out;
}

export interface ScheduleDay {
  date: string;
  /** Effective schedules on this date (one per count basis). Empty = no documented schedule. */
  schedules: ServiceSchedule[];
  /** Service events on this date (dow in service_dows, not closed). */
  events: ServiceEvent[];
  closed: boolean;
}

/**
 * Day-by-day resolution over [fromDate, toDateExcl). A date is closed when CLOSURE windows
 * cover the whole local day; closed dates produce no events.
 */
export function resolveScheduleDays(
  schedules: readonly ServiceSchedule[],
  fromDate: string,
  toDateExcl: string,
  opts: { closures?: readonly DatedWindow[]; tz?: string } = {},
): ScheduleDay[] {
  const tz = opts.tz ?? DEFAULT_TZ;
  const closures = opts.closures ?? [];
  return localDateRange(fromDate, toDateExcl).map((date) => {
    const effective = effectiveSchedulesOn(schedules, date);
    const closed = closures.length > 0 && isDateFullyBlocked(date, closures, tz);
    const dow = isoDow(date);
    const events: ServiceEvent[] = closed
      ? []
      : effective
          .filter((s) => s.service_dows.includes(dow))
          .map((s) => ({
            date,
            schedule_id: s.id,
            count_basis: s.count_basis,
            people: s.people_per_event,
            verified: s.verified_count != null,
          }));
    return { date, schedules: effective, events, closed };
  });
}

/** All service events in [fromDate, toDateExcl). */
export function serviceEvents(
  schedules: readonly ServiceSchedule[],
  fromDate: string,
  toDateExcl: string,
  opts: { closures?: readonly DatedWindow[]; tz?: string } = {},
): ServiceEvent[] {
  return resolveScheduleDays(schedules, fromDate, toDateExcl, opts).flatMap((d) => d.events);
}

/**
 * People counts per basis on a date, never summed across bases. Callers display each
 * basis separately ("40 penghuni harian · 200 jangkauan mingguan").
 */
export function peopleByBasisOn(
  schedules: readonly ServiceSchedule[],
  date: string,
): Partial<Record<CountBasis, { people: number; schedule_id: string; verified: boolean }>> {
  const out: Partial<Record<CountBasis, { people: number; schedule_id: string; verified: boolean }>> = {};
  for (const s of effectiveSchedulesOn(schedules, date)) {
    out[s.count_basis] = { people: s.people_per_event, schedule_id: s.id, verified: s.verified_count != null };
  }
  return out;
}
