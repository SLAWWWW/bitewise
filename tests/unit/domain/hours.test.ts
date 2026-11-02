import { describe, expect, it } from 'vitest';
import {
  addContactMinutes,
  contactMinutesBetween,
  dailyWindows,
  isContactOpenAt,
  isDateFullyBlocked,
  isOpenAt,
  isReceivingOpenAt,
  isoDow,
  mergeSpans,
  nextOpenAt,
  parseLocalTime,
  parseWeeklyWindows,
  splitAvailability,
  subtractSpans,
  windowsOnDate,
  type WeeklyWindow,
} from '@/src/domain/flo/hours';

// Seed contact hours: 08:00–20:00 WIB every day.
const CONTACT = dailyWindows('08:00', '20:00');
const wib = (local: string) => new Date(`${local}+07:00`);

describe('basics', () => {
  it('uses ISO day of week (Monday = 1, Sunday = 7)', () => {
    expect(isoDow('2026-10-26')).toBe(1); // seed clock Monday
    expect(isoDow('2026-10-31')).toBe(6);
    expect(isoDow('2026-11-01')).toBe(7);
  });

  it('parses pg time text including seconds and 24:00', () => {
    expect(parseLocalTime('08:00')).toBe(8 * 3600);
    expect(parseLocalTime('20:30:15')).toBe(20 * 3600 + 30 * 60 + 15);
    expect(parseLocalTime('24:00:00')).toBe(86_400);
    expect(() => parseLocalTime('25:00')).toThrow(RangeError);
    expect(() => parseLocalTime('8am')).toThrow(RangeError);
  });

  it('materialises windows on a local date in WIB regardless of machine TZ', () => {
    const spans = windowsOnDate('2026-10-26', CONTACT);
    expect(spans).toHaveLength(1);
    expect(new Date(spans[0].start).toISOString()).toBe('2026-10-26T01:00:00.000Z');
    expect(new Date(spans[0].end).toISOString()).toBe('2026-10-26T13:00:00.000Z');
    const late = windowsOnDate('2026-10-26', [{ dow: 1, start_local: '22:00', end_local: '24:00' }]);
    expect(new Date(late[0].end).toISOString()).toBe('2026-10-26T17:00:00.000Z');
  });

  it('merges and subtracts half-open spans', () => {
    expect(mergeSpans([{ start: 5, end: 8 }, { start: 0, end: 5 }, { start: 10, end: 12 }])).toEqual([
      { start: 0, end: 8 },
      { start: 10, end: 12 },
    ]);
    expect(subtractSpans([{ start: 0, end: 10 }], [{ start: 2, end: 4 }, { start: 8, end: 20 }])).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 8 },
    ]);
  });
});

describe('isOpenAt', () => {
  it('is start-inclusive and end-exclusive', () => {
    expect(isOpenAt(wib('2026-10-26T07:59:59.999'), CONTACT)).toBe(false);
    expect(isOpenAt(wib('2026-10-26T08:00:00'), CONTACT)).toBe(true);
    expect(isOpenAt(wib('2026-10-26T19:59:59.999'), CONTACT)).toBe(true);
    expect(isOpenAt(wib('2026-10-26T20:00:00'), CONTACT)).toBe(false);
  });

  it('respects day-specific windows and closures', () => {
    const receiving: WeeklyWindow[] = [
      { dow: 1, start_local: '09:00', end_local: '12:00' },
      { dow: 3, start_local: '13:00:00', end_local: '17:00:00' },
    ];
    const availability = splitAvailability([
      ...receiving.map((w) => ({ kind: 'RECEIVING' as const, ...w })),
      ...CONTACT.map((w) => ({ kind: 'CONTACT' as const, ...w })),
      { kind: 'CLOSURE', starts_at: wib('2026-10-28T00:00:00'), ends_at: wib('2026-10-29T00:00:00') },
      { kind: 'UNAVAILABLE', starts_at: wib('2026-10-26T10:00:00'), ends_at: wib('2026-10-26T11:00:00') },
    ]);
    expect(isReceivingOpenAt(wib('2026-10-26T09:30:00'), availability)).toBe(true);
    expect(isReceivingOpenAt(wib('2026-10-26T10:30:00'), availability)).toBe(false); // unavailable
    expect(isReceivingOpenAt(wib('2026-10-27T09:30:00'), availability)).toBe(false); // Tuesday: no window
    expect(isReceivingOpenAt(wib('2026-10-28T14:00:00'), availability)).toBe(false); // Wednesday closure
    expect(isReceivingOpenAt(wib('2026-11-04T14:00:00'), availability)).toBe(true); // next Wednesday
    expect(isContactOpenAt(wib('2026-10-28T14:00:00'), availability)).toBe(true); // closure ≠ contact block
    expect(isContactOpenAt(wib('2026-10-26T10:30:00'), availability)).toBe(false);
  });

  it('rejects malformed availability rows', () => {
    expect(() => splitAvailability([{ kind: 'CONTACT', dow: 1, start_local: '10:00', end_local: '09:00' }])).toThrow();
    expect(() => splitAvailability([{ kind: 'CLOSURE', starts_at: null, ends_at: null }])).toThrow();
    expect(() => splitAvailability([{ kind: 'RECEIVING', dow: 8, start_local: '08:00', end_local: '09:00' }])).toThrow();
  });

  it('parses jsonb contact hours and keeps unknown as null', () => {
    expect(parseWeeklyWindows(null)).toBeNull();
    expect(parseWeeklyWindows([{ dow: 1, start_local: '08:00', end_local: '20:00' }])).toHaveLength(1);
    expect(() => parseWeeklyWindows([{ dow: 1, start_local: '20:00', end_local: '08:00' }])).toThrow();
  });
});

describe('contactMinutesBetween (responsiveness)', () => {
  it('counts only minutes inside contact hours', () => {
    // Inside one window.
    expect(contactMinutesBetween(wib('2026-10-26T10:00:00'), wib('2026-10-26T10:45:00'), CONTACT)).toBe(45);
    // Offer sent 19:30, reply next day 08:30 → 30 + 30 contact minutes, overnight ignored.
    expect(contactMinutesBetween(wib('2026-10-26T19:30:00'), wib('2026-10-27T08:30:00'), CONTACT)).toBe(60);
    // Entirely out of hours.
    expect(contactMinutesBetween(wib('2026-10-26T21:00:00'), wib('2026-10-27T07:00:00'), CONTACT)).toBe(0);
    // Reversed or empty interval.
    expect(contactMinutesBetween(wib('2026-10-27T08:30:00'), wib('2026-10-26T19:30:00'), CONTACT)).toBe(0);
  });

  it('spans several days and weekday-only hours', () => {
    const weekdays = dailyWindows('09:00', '17:00', [1, 2, 3, 4, 5]);
    // Fri 2026-10-30 16:00 → Mon 2026-11-02 10:00: 60 (Fri) + 0 (Sat/Sun) + 60 (Mon).
    expect(contactMinutesBetween(wib('2026-10-30T16:00:00'), wib('2026-11-02T10:00:00'), weekdays)).toBe(120);
    // A full week = 5 × 8 h.
    expect(contactMinutesBetween(wib('2026-10-26T00:00:00'), wib('2026-11-02T00:00:00'), weekdays)).toBe(5 * 8 * 60);
  });

  it('does not double count overlapping windows and subtracts blocks', () => {
    const overlapping: WeeklyWindow[] = [
      { dow: 1, start_local: '08:00', end_local: '12:00' },
      { dow: 1, start_local: '11:00', end_local: '13:00' },
    ];
    expect(contactMinutesBetween(wib('2026-10-26T00:00:00'), wib('2026-10-27T00:00:00'), overlapping)).toBe(300);
    const outage = [{ starts_at: wib('2026-10-26T09:00:00'), ends_at: wib('2026-10-26T10:00:00') }];
    expect(contactMinutesBetween(wib('2026-10-26T08:00:00'), wib('2026-10-26T12:00:00'), CONTACT, 'Asia/Jakarta', outage)).toBe(180);
  });

  it('returns fractional minutes exactly', () => {
    expect(contactMinutesBetween(wib('2026-10-26T10:00:00'), wib('2026-10-26T10:00:30'), CONTACT)).toBe(0.5);
  });

  it('is independent of the time zone argument only through local wall time', () => {
    // Same wall-clock hours evaluated in WITA (UTC+8) shift by one hour in UTC.
    const a = new Date('2026-10-26T00:00:00Z'); // 08:00 WITA, 07:00 WIB
    const b = new Date('2026-10-26T01:00:00Z');
    expect(contactMinutesBetween(a, b, CONTACT, 'Asia/Makassar')).toBe(60);
    expect(contactMinutesBetween(a, b, CONTACT, 'Asia/Jakarta')).toBe(0);
  });
});

describe('addContactMinutes (inverse)', () => {
  it('rolls over to the next contact window', () => {
    expect(addContactMinutes(wib('2026-10-26T19:30:00'), 60, CONTACT)?.toISOString()).toBe(
      wib('2026-10-27T08:30:00').toISOString(),
    );
    // "4 contact hours" offer window starting before opening hours.
    expect(addContactMinutes(wib('2026-10-26T06:00:00'), 240, CONTACT)?.toISOString()).toBe(
      wib('2026-10-26T12:00:00').toISOString(),
    );
  });

  it('round-trips with contactMinutesBetween for fixed inputs', () => {
    const starts = ['2026-10-26T07:00:00', '2026-10-26T12:34:00', '2026-10-26T19:59:00', '2026-10-31T23:00:00'];
    const minutes = [1, 2, 12, 20, 90, 120, 240, 720, 1500];
    for (const s of starts) {
      for (const m of minutes) {
        const end = addContactMinutes(wib(s), m, CONTACT);
        expect(end).not.toBeNull();
        expect(contactMinutesBetween(wib(s), end!, CONTACT)).toBe(m);
      }
    }
  });

  it('returns null instead of inventing a deadline when there are no windows', () => {
    expect(addContactMinutes(wib('2026-10-26T10:00:00'), 10, [])).toBeNull();
    expect(addContactMinutes(wib('2026-10-26T10:00:00'), 0, [])?.toISOString()).toBe(wib('2026-10-26T10:00:00').toISOString());
    expect(() => addContactMinutes(wib('2026-10-26T10:00:00'), -1, CONTACT)).toThrow(RangeError);
  });

  it('skips blocked time', () => {
    const outage = [{ starts_at: wib('2026-10-26T10:00:00'), ends_at: wib('2026-10-26T11:00:00') }];
    expect(addContactMinutes(wib('2026-10-26T09:30:00'), 60, CONTACT, 'Asia/Jakarta', outage)?.toISOString()).toBe(
      wib('2026-10-26T11:30:00').toISOString(),
    );
  });
});

describe('nextOpenAt and closures', () => {
  it('finds the next opening', () => {
    expect(nextOpenAt(wib('2026-10-26T21:00:00'), CONTACT)?.toISOString()).toBe(wib('2026-10-27T08:00:00').toISOString());
    expect(nextOpenAt(wib('2026-10-26T09:00:00'), CONTACT)?.toISOString()).toBe(wib('2026-10-26T09:00:00').toISOString());
    expect(nextOpenAt(wib('2026-10-26T09:00:00'), [])).toBeNull();
  });

  it('detects fully closed local days', () => {
    const closure = [{ starts_at: wib('2026-10-28T00:00:00'), ends_at: wib('2026-10-29T00:00:00') }];
    expect(isDateFullyBlocked('2026-10-28', closure)).toBe(true);
    expect(isDateFullyBlocked('2026-10-27', closure)).toBe(false);
    const partial = [{ starts_at: wib('2026-10-28T10:00:00'), ends_at: wib('2026-10-28T14:00:00') }];
    expect(isDateFullyBlocked('2026-10-28', partial)).toBe(false);
  });
});
