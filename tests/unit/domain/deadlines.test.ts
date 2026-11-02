import { describe, expect, it } from 'vitest';
import {
  computeDueAt,
  dueExclusiveBound,
  dueLocalDate,
  isOnTime,
  timeliness,
} from '@/src/domain/reporting/deadlines';
import { formatWib } from '@/src/lib/tz';

const wib = (local: string) => new Date(`${local}+07:00`);
// SC07: dispatch Monday 2026-10-26 10:00 WIB (seed clock + 2 h).
const DISPATCH = wib('2026-10-26T10:00:00');

describe('computeDueAt (AC28)', () => {
  it('calendar rule: Monday dispatch → Tuesday 23:59:59.999 WIB', () => {
    const due = computeDueAt('CALENDAR_NEXT_DAY_EOD', DISPATCH, 'Asia/Jakarta');
    expect(due.toISOString()).toBe('2026-10-27T16:59:59.999Z');
    expect(formatWib(due, { seconds: true, locale: 'en' })).toBe('27 Oct 2026, 23:59:59 WIB');
    expect(dueExclusiveBound('CALENDAR_NEXT_DAY_EOD', DISPATCH).toISOString()).toBe('2026-10-27T17:00:00.000Z');
    expect(dueLocalDate(due)).toBe('2026-10-27');
  });

  it('24 h rule: Monday 10:00 → Tuesday 10:00 WIB', () => {
    const due = computeDueAt('ROLLING_24H', DISPATCH);
    expect(due.toISOString()).toBe('2026-10-27T03:00:00.000Z');
    expect(formatWib(due, { locale: 'en' })).toBe('27 Oct 2026, 10:00 WIB');
  });

  it('the two rules differ as specified', () => {
    const calendar = computeDueAt('CALENDAR_NEXT_DAY_EOD', DISPATCH);
    const rolling = computeDueAt('ROLLING_24H', DISPATCH);
    expect(calendar.getTime() - rolling.getTime()).toBe(14 * 3_600_000 - 1);
  });

  it('AT_RECEIPT is due at the anchor (BAST)', () => {
    const receipt = wib('2026-10-27T08:15:00');
    expect(computeDueAt('AT_RECEIPT', receipt).toISOString()).toBe(receipt.toISOString());
  });

  it('calendar rule depends on the local date, not the UTC date', () => {
    // Monday 06:30 WIB is still Sunday 23:30 UTC; the deadline follows the WIB Monday.
    expect(computeDueAt('CALENDAR_NEXT_DAY_EOD', wib('2026-10-26T06:30:00')).toISOString()).toBe('2026-10-27T16:59:59.999Z');
    // Monday 23:59:59.999 WIB still gives Tuesday EOD; Tuesday 00:00 gives Wednesday EOD.
    expect(computeDueAt('CALENDAR_NEXT_DAY_EOD', wib('2026-10-26T23:59:59.999')).toISOString()).toBe('2026-10-27T16:59:59.999Z');
    expect(computeDueAt('CALENDAR_NEXT_DAY_EOD', wib('2026-10-27T00:00:00')).toISOString()).toBe('2026-10-28T16:59:59.999Z');
    // Month end: Saturday 2026-10-31 → Sunday 2026-11-01 EOD.
    expect(computeDueAt('CALENDAR_NEXT_DAY_EOD', wib('2026-10-31T12:00:00')).toISOString()).toBe('2026-11-01T16:59:59.999Z');
    // REP03: Wednesday distribution → Thursday EOD.
    expect(computeDueAt('CALENDAR_NEXT_DAY_EOD', wib('2026-10-28T12:00:00')).toISOString()).toBe('2026-10-29T16:59:59.999Z');
  });

  it('uses the given zone, not the machine zone', () => {
    expect(process.env.TZ).toBe('UTC');
    expect(computeDueAt('CALENDAR_NEXT_DAY_EOD', DISPATCH, 'Asia/Jayapura').toISOString()).toBe('2026-10-27T14:59:59.999Z');
  });
});

describe('on-time boundary and SQL parity', () => {
  const due = computeDueAt('CALENDAR_NEXT_DAY_EOD', DISPATCH);

  it('submitted_at <= due_at is on time; the next instant is late', () => {
    expect(isOnTime(wib('2026-10-27T23:59:59.999'), due)).toBe(true);
    expect(isOnTime(wib('2026-10-28T00:00:00.000'), due)).toBe(false);
  });

  it('a DB microsecond instant (…23:59:59.999999) read through pg truncates to .999 and stays on time', () => {
    // pg parses '2026-10-27 23:59:59.999999+07' into a JS Date with ms resolution.
    const truncated = new Date(Date.parse('2026-10-27T23:59:59.999+07:00'));
    expect(isOnTime(truncated, due)).toBe(true);
  });

  it('ROLLING_24H is inclusive at exactly 24 h', () => {
    const rolling = computeDueAt('ROLLING_24H', DISPATCH);
    expect(isOnTime(wib('2026-10-27T10:00:00'), rolling)).toBe(true);
    expect(isOnTime(wib('2026-10-27T10:00:00.001'), rolling)).toBe(false);
  });
});

describe('timeliness', () => {
  const calendarDue = computeDueAt('CALENDAR_NEXT_DAY_EOD', DISPATCH);
  const rollingDue = computeDueAt('ROLLING_24H', DISPATCH);
  // SC07: receipt photo Tuesday 22:00 WIB.
  const photo = wib('2026-10-27T22:00:00');

  it('SC07: receipt photo on time under calendar H+1, late under 24 h', () => {
    expect(timeliness('ACCEPTED', calendarDue, photo, wib('2026-10-28T09:00:00'))).toBe('ON_TIME');
    expect(timeliness('ACCEPTED', rollingDue, photo, wib('2026-10-28T09:00:00'))).toBe('LATE');
  });

  it('SC07: distribution Wednesday noon, evidence Thursday 20:00 → on time', () => {
    const due = computeDueAt('CALENDAR_NEXT_DAY_EOD', wib('2026-10-28T12:00:00'));
    expect(timeliness({ state: 'ACCEPTED', due_at: due, submitted_at: wib('2026-10-29T20:00:00'), now: wib('2026-10-30T08:00:00') })).toBe('ON_TIME');
  });

  it('open obligations are NOT_DUE until due_at, then MISSING', () => {
    expect(timeliness('OPEN', calendarDue, null, wib('2026-10-27T23:59:59.999'))).toBe('NOT_DUE');
    expect(timeliness('OPEN', calendarDue, null, wib('2026-10-28T00:00:00'))).toBe('MISSING');
  });

  it('AC31: late staff approval keeps the original adequate submission time', () => {
    // Submitted on time, reviewed (accepted) days later.
    expect(timeliness('ACCEPTED', calendarDue, photo, wib('2026-11-05T10:00:00'))).toBe('ON_TIME');
  });

  it('AC32: an inadequate on-time version does not count; the late corrected version is LATE', () => {
    // While awaiting clarification after the deadline, there is no adequate submission.
    expect(timeliness('NEEDS_CLARIFICATION', calendarDue, photo, wib('2026-10-28T09:00:00'))).toBe('MISSING');
    // Corrected version submitted after the deadline and accepted.
    expect(timeliness('ACCEPTED', calendarDue, wib('2026-10-28T09:30:00'), wib('2026-10-28T12:00:00'))).toBe('LATE');
  });

  it('pending review reports provisional timeliness; final rejection has no adequate submission', () => {
    expect(timeliness('UNDER_REVIEW', calendarDue, photo, wib('2026-10-28T09:00:00'))).toBe('ON_TIME');
    expect(timeliness('REJECTED_FINAL', calendarDue, photo, wib('2026-10-28T09:00:00'))).toBe('MISSING');
    expect(timeliness('EXCUSED', calendarDue, null, wib('2026-10-28T09:00:00'))).toBe('MISSING');
  });

  it('states that require a submission time refuse to guess', () => {
    expect(() => timeliness('ACCEPTED', calendarDue, null, wib('2026-10-28T09:00:00'))).toThrow(RangeError);
  });
});
