/**
 * Time-zone helpers on @date-fns/tz. Never rely on the machine TZ (it is +08 here and
 * UTC in tests). Local legal dates are 'YYYY-MM-DD' strings; instants are Date.
 */
import { TZDate } from '@date-fns/tz';

export const DEFAULT_TZ = 'Asia/Jakarta';

export type Instant = Date | string | number;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDate(i: Instant): Date {
  const d = i instanceof Date ? i : new Date(i);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid instant: ${String(i)}`);
  return d;
}

function parseLocalDate(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Invalid local date (YYYY-MM-DD): ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local calendar date of an instant in `tz`, as 'YYYY-MM-DD'. */
export function localDate(instant: Instant, tz: string = DEFAULT_TZ): string {
  const z = new TZDate(toDate(instant).getTime(), tz);
  return `${pad(z.getFullYear(), 4)}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`;
}

/** Instant of 00:00 local time on `date` in `tz`. */
export function startOfLocalDay(date: string, tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = parseLocalDate(date);
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, 0, tz).getTime());
}

/** Calendar arithmetic on a local date (no time zone involved). */
export function addLocalDays(date: string, days: number): string {
  const [y, m, d] = parseLocalDate(date);
  const u = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(u.getUTCFullYear(), 4)}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`;
}

/** Exclusive end of a local day = 00:00 of the next local day. */
export function endOfLocalDayExclusive(date: string, tz: string = DEFAULT_TZ): Date {
  return startOfLocalDay(addLocalDays(date, 1), tz);
}

/** Day of week of a local date, 0 = Sunday … 6 = Saturday. */
export function localDow(date: string): number {
  const [y, m, d] = parseLocalDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole local days between two local dates (b − a). */
export function localDaysBetween(a: string, b: string): number {
  const [ya, ma, da] = parseLocalDate(a);
  const [yb, mb, db] = parseLocalDate(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

const TZ_LABELS: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Pontianak': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
  UTC: 'UTC',
};

export function tzLabel(tz: string = DEFAULT_TZ): string {
  return TZ_LABELS[tz] ?? tz;
}

export type UiLocale = 'id' | 'en';

function intlLocale(locale: UiLocale | string): string {
  if (locale === 'id') return 'id-ID';
  if (locale === 'en') return 'en-GB';
  return locale;
}

export interface FormatOptions {
  locale?: UiLocale | string;
  tz?: string;
  /** 'datetime' (default), 'date', 'time'. */
  style?: 'datetime' | 'date' | 'time';
  seconds?: boolean;
  /** Append the zone label (default true). */
  label?: boolean;
}

/**
 * Format an instant with an explicit time zone and its label, e.g.
 * "26 Okt 2026 08.00 WIB" (id) / "26 Oct 2026, 08:00 WIB" (en).
 */
export function formatWib(instant: Instant, opts: FormatOptions = {}): string {
  const tz = opts.tz ?? DEFAULT_TZ;
  const style = opts.style ?? 'datetime';
  const fmt: Intl.DateTimeFormatOptions = { timeZone: tz };
  if (style !== 'time') Object.assign(fmt, { day: 'numeric', month: 'short', year: 'numeric' });
  if (style !== 'date') {
    Object.assign(fmt, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (opts.seconds) fmt.second = '2-digit';
  }
  const text = new Intl.DateTimeFormat(intlLocale(opts.locale ?? 'id'), fmt).format(toDate(instant));
  return opts.label === false || style === 'date' ? text : `${text} ${tzLabel(tz)}`;
}

/** Format a legal local date ('YYYY-MM-DD') without any time-zone shift. */
export function formatLocalDate(date: string, locale: UiLocale | string = 'id'): string {
  const [y, m, d] = parseLocalDate(date);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "dalam 2 jam" / "3 hari yang lalu" relative to an explicit `now` (tenant clock). */
export function formatRelative(instant: Instant, now: Instant, locale: UiLocale | string = 'id'): string {
  const diffMs = toDate(instant).getTime() - toDate(now).getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.trunc(diffMs / ms), unit);
  }
  return rtf.format(0, 'minute');
}
