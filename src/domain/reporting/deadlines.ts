/**
 * Evidence obligation deadlines and timeliness (PRD §15 REP01–REP03, AC28, AC31, AC32).
 *
 * Rules (evidence_obligations.due_rule):
 *   CALENDAR_NEXT_DAY_EOD  end of the next local day: 23:59:59.999999 local on (anchor date + 1)
 *   ROLLING_24H            anchor + 24 h exactly
 *   AT_RECEIPT             the anchor itself (BAST is due at actual receipt; any demo reminder
 *                          grace is a reminder concern and does not move the due time)
 *
 * Resolution and SQL parity
 * -------------------------
 * SQL stores the calendar deadline with microsecond precision as
 *   ((anchor AT TIME ZONE tz)::date + 2)::timestamp AT TIME ZONE tz - interval '1 microsecond'
 * i.e. …23:59:59.999999 local. JS Date has millisecond resolution, so TS represents the same
 * deadline as …23:59:59.999 local (the exclusive bound minus 1 ms).
 * On time iff submitted_at <= due_at. The two agree for every submission instant:
 *   - a submission from TS has ms resolution, so it is <= .999 iff it is < the exclusive bound;
 *   - a DB timestamptz read through pg is truncated to ms, so any instant in
 *     (…23:59:59.999, …23:59:59.999999] reads as .999 and stays on time, and the exclusive
 *     bound (00:00:00.000000 next day) stays late.
 * dueExclusiveBound() exposes the resolution-independent first-late instant.
 *
 * Pure: `now` is always passed in (tenant clock).
 */
import { DEFAULT_TZ, addLocalDays, localDate, startOfLocalDay, type Instant } from '@/src/lib/tz';
import type { ObligationState, Timeliness } from '@/src/shared/enums';

import { DUE_RULES, type DueRule } from '@/src/shared/enums';
export { DUE_RULES, type DueRule };

export const HOUR_MS = 3_600_000;

function ms(i: Instant): number {
  const d = i instanceof Date ? i : new Date(i);
  const v = d.getTime();
  if (Number.isNaN(v)) throw new RangeError(`Invalid instant: ${String(i)}`);
  return v;
}

/**
 * Exclusive bound of the deadline: the first instant that is late.
 * CALENDAR_NEXT_DAY_EOD → 00:00 local on (anchor local date + 2).
 */
export function dueExclusiveBound(rule: DueRule, anchor: Instant, tz: string = DEFAULT_TZ): Date {
  const a = ms(anchor);
  switch (rule) {
    case 'CALENDAR_NEXT_DAY_EOD':
      return startOfLocalDay(addLocalDays(localDate(a, tz), 2), tz);
    case 'ROLLING_24H':
      return new Date(a + 24 * HOUR_MS + 1);
    case 'AT_RECEIPT':
      return new Date(a + 1);
    default: {
      const never: never = rule;
      throw new RangeError(`Unknown due rule: ${String(never)}`);
    }
  }
}

/**
 * Inclusive due instant (ms resolution): on time iff submitted_at <= due_at.
 * CALENDAR_NEXT_DAY_EOD → next local day 23:59:59.999 (SQL: .999999, see module doc).
 */
export function computeDueAt(rule: DueRule, anchor: Instant, tz: string = DEFAULT_TZ): Date {
  return new Date(dueExclusiveBound(rule, anchor, tz).getTime() - 1);
}

/** submitted_at <= due_at (at ms resolution this equals submitted_at < dueExclusiveBound). */
export function isOnTime(submittedAt: Instant, dueAt: Instant): boolean {
  return ms(submittedAt) <= ms(dueAt);
}

export interface TimelinessInput {
  state: ObligationState;
  due_at: Instant;
  /**
   * Submission time of the version that governs timeliness: the accepted version, or the
   * pending one while SUBMITTED / UNDER_REVIEW. Ignored for OPEN, NEEDS_CLARIFICATION and
   * REJECTED_FINAL (an inadequate submission does not satisfy the obligation).
   */
  submitted_at?: Instant | null;
  now: Instant;
}

/**
 * Timeliness as a time fact:
 *   ACCEPTED / SUBMITTED / UNDER_REVIEW (with submitted_at)  → ON_TIME | LATE
 *   EXCUSED with submitted_at                                 → ON_TIME | LATE
 *   no governing submission                                   → NOT_DUE while now <= due_at, else MISSING
 * EXCUSED and pending-review obligations are excluded from scoring by their *state*; this
 * function does not hide them. A later-accepted correction keeps the timeliness of its own
 * submitted_at (AC32), and late staff approval keeps the original time (AC31) because only
 * submitted_at is compared, never reviewed_at.
 */
export function timeliness(input: TimelinessInput): Timeliness;
export function timeliness(
  state: ObligationState,
  due_at: Instant,
  submitted_at: Instant | null | undefined,
  now: Instant,
): Timeliness;
export function timeliness(
  a: TimelinessInput | ObligationState,
  due?: Instant,
  sub?: Instant | null,
  now?: Instant,
): Timeliness {
  const input: TimelinessInput =
    typeof a === 'object' ? a : { state: a, due_at: due as Instant, submitted_at: sub, now: now as Instant };
  const dueMs = ms(input.due_at);
  const counts =
    input.state === 'ACCEPTED' ||
    input.state === 'SUBMITTED' ||
    input.state === 'UNDER_REVIEW' ||
    input.state === 'EXCUSED';
  if (counts && input.submitted_at != null) {
    return ms(input.submitted_at) <= dueMs ? 'ON_TIME' : 'LATE';
  }
  if ((input.state === 'ACCEPTED' || input.state === 'SUBMITTED' || input.state === 'UNDER_REVIEW') && input.submitted_at == null) {
    throw new RangeError(`Obligation in state ${input.state} needs submitted_at`);
  }
  return ms(input.now) <= dueMs ? 'NOT_DUE' : 'MISSING';
}

/** Local calendar date of the due instant (for "batas: Selasa 27 Okt" labels). */
export function dueLocalDate(dueAt: Instant, tz: string = DEFAULT_TZ): string {
  return localDate(dueAt, tz);
}
