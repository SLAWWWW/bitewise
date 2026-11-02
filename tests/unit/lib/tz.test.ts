import { describe, it, expect } from 'vitest';
import {
  addLocalDays,
  endOfLocalDayExclusive,
  formatLocalDate,
  formatRelative,
  formatWib,
  localDate,
  localDaysBetween,
  localDow,
  startOfLocalDay,
  tzLabel,
} from '@/src/lib/tz';

describe('environment', () => {
  it('runs with TZ=UTC so local-time bugs surface', () => {
    expect(process.env.TZ).toBe('UTC');
    expect(new Date('2026-10-26T00:00:00').getTimezoneOffset()).toBe(0);
  });
});

describe('local dates in Asia/Jakarta (UTC+7, no DST)', () => {
  it('maps instants to the WIB calendar date across the UTC midnight boundary', () => {
    expect(localDate('2026-10-26T01:00:00Z')).toBe('2026-10-26'); // seed clock, 08:00 WIB Monday
    expect(localDate('2026-10-25T16:59:59.999Z')).toBe('2026-10-25');
    expect(localDate('2026-10-25T17:00:00Z')).toBe('2026-10-26');
  });

  it('starts a local day at 17:00Z of the previous UTC day', () => {
    expect(startOfLocalDay('2026-10-26').toISOString()).toBe('2026-10-25T17:00:00.000Z');
  });

  it('handles the 2026-10-31 month end (AC03: through 31 Oct → exclusive 1 Nov 00:00 WIB)', () => {
    const end = endOfLocalDayExclusive('2026-10-31');
    expect(end.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(localDate(new Date(end.getTime() - 1))).toBe('2026-10-31');
    expect(localDate(end)).toBe('2026-11-01');
    expect(addLocalDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('does calendar arithmetic over month and year ends', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2026-10-26', -29)).toBe('2026-09-27');
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(localDaysBetween('2026-10-26', '2026-11-25')).toBe(30);
  });

  it('knows the weekday of the seed date (Monday) and 2026-10-31 (Saturday)', () => {
    expect(localDow('2026-10-26')).toBe(1);
    expect(localDow('2026-10-31')).toBe(6);
  });

  it('matches a fixed +07:00 offset sanity check', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-07-01T12:34:00Z', '2026-10-31T16:59:59Z']) {
      const shifted = new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
      expect(localDate(iso)).toBe(shifted);
    }
  });

  it('rejects malformed local dates', () => {
    expect(() => startOfLocalDay('26/10/2026')).toThrow(RangeError);
  });
});

describe('formatting with explicit zone + label', () => {
  it('formats WIB with the label in both locales', () => {
    const s = formatWib('2026-10-26T01:00:00Z', { locale: 'id' });
    expect(s).toMatch(/26 Okt 2026/);
    expect(s).toMatch(/08[.:]00/);
    expect(s.endsWith(' WIB')).toBe(true);
    const e = formatWib('2026-10-26T01:00:00Z', { locale: 'en' });
    expect(e).toMatch(/26 Oct 2026/);
    expect(e.endsWith('08:00 WIB')).toBe(true);
  });

  it('formats the WIB date of an instant late in the UTC day', () => {
    expect(formatWib('2026-10-31T17:30:00Z', { locale: 'en', style: 'date' })).toBe('1 Nov 2026');
  });

  it('labels other Indonesian zones', () => {
    expect(tzLabel('Asia/Makassar')).toBe('WITA');
    expect(formatWib('2026-10-26T01:00:00Z', { locale: 'en', tz: 'Asia/Makassar', style: 'time' })).toBe('09:00 WITA');
  });

  it('formats a legal date without zone shift', () => {
    expect(formatLocalDate('2026-10-31', 'en')).toBe('31 Oct 2026');
  });

  it('formats relative time against an explicit now', () => {
    expect(formatRelative('2026-10-26T03:00:00Z', '2026-10-26T01:00:00Z', 'en')).toBe('in 2 hours');
    expect(formatRelative('2026-10-23T01:00:00Z', '2026-10-26T01:00:00Z', 'id')).toBe('3 hari yang lalu');
  });
});
