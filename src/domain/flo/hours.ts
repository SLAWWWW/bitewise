/**
 * Weekly local-time windows (receiving / contact hours) and dated closures (PRD §5,
 * architecture A.1 `availability_windows`).
 *
 * - Weekly windows use ISO day of week (1 = Monday … 7 = Sunday) and local wall times
 *   'HH:MM' or 'HH:MM:SS' (pg `time` text). End is exclusive and must be after start on
 *   the same day; '24:00' is allowed as an end. Overnight windows are two rows.
 * - CLOSURE / UNAVAILABLE rows are half-open instant intervals [starts_at, ends_at).
 * - Everything is evaluated in an explicit tenant time zone; never the machine TZ.
 *
 * Pure: callers pass `now`/instants in.
 */
import { TZDate } from '@date-fns/tz';
import { z } from 'zod';
import { DEFAULT_TZ, addLocalDays, localDate, localDow, type Instant } from '@/src/lib/tz';

export const MINUTE_MS = 60_000;
/** Safety bound for forward searches (addContactMinutes, nextOpenAt). */
export const MAX_SEARCH_DAYS = 400;

export type IsoDow = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WeeklyWindow {
  dow: number;
  start_local: string;
  end_local: string;
}

export interface DatedWindow {
  starts_at: Instant;
  ends_at: Instant;
}

export type AvailabilityKind = 'RECEIVING' | 'CONTACT' | 'CLOSURE' | 'UNAVAILABLE';

/** Row shape of lumbung.availability_windows (nullable columns by kind). */
export interface AvailabilityRow {
  kind: AvailabilityKind;
  dow?: number | null;
  start_local?: string | null;
  end_local?: string | null;
  starts_at?: Instant | null;
  ends_at?: Instant | null;
}

export interface FloAvailability {
  receiving: WeeklyWindow[];
  contact: WeeklyWindow[];
  closures: DatedWindow[];
  unavailable: DatedWindow[];
}

/** Half-open [start, end) in epoch ms. */
export interface Span {
  start: number;
  end: number;
}

const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;

function ms(i: Instant): number {
  const d = i instanceof Date ? i : new Date(i);
  const v = d.getTime();
  if (Number.isNaN(v)) throw new RangeError(`Invalid instant: ${String(i)}`);
  return v;
}

/** 'HH:MM[:SS]' → seconds after local midnight (0 … 86400). */
export function parseLocalTime(s: string): number {
  const m = TIME_RE.exec(s.trim());
  if (!m) throw new RangeError(`Invalid local time: ${s}`);
  const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
  if (secs > 86_400) throw new RangeError(`Invalid local time: ${s}`);
  return secs;
}

/** ISO day of week of a local date: Monday = 1 … Sunday = 7. */
export function isoDow(date: string): IsoDow {
  const d = localDow(date);
  return (d === 0 ? 7 : d) as IsoDow;
}

function assertWindow(w: WeeklyWindow): { start: number; end: number } {
  if (!Number.isInteger(w.dow) || w.dow < 1 || w.dow > 7) throw new RangeError(`Invalid ISO dow: ${w.dow}`);
  const start = parseLocalTime(w.start_local);
  const end = parseLocalTime(w.end_local);
  if (end <= start) throw new RangeError(`Window end ${w.end_local} must be after start ${w.start_local}`);
  return { start, end };
}

/** Instant of `secs` seconds after local midnight of `date` in `tz` (24:00 = next midnight). */
function localInstant(date: string, secs: number, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  if (secs === 86_400) {
    const [ny, nm, nd] = addLocalDays(date, 1).split('-').map(Number);
    return new TZDate(ny, nm - 1, nd, 0, 0, 0, 0, tz).getTime();
  }
  const h = Math.floor(secs / 3600);
  const mi = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return new TZDate(y, mo - 1, d, h, mi, s, 0, tz).getTime();
}

/** Same windows on every day of the week, e.g. dailyWindows('08:00', '20:00'). */
export function dailyWindows(start_local: string, end_local: string, dows: readonly number[] = [1, 2, 3, 4, 5, 6, 7]): WeeklyWindow[] {
  return dows.map((dow) => ({ dow, start_local, end_local }));
}

/** Group availability rows by kind. Rows missing the columns for their kind throw. */
export function splitAvailability(rows: readonly AvailabilityRow[]): FloAvailability {
  const out: FloAvailability = { receiving: [], contact: [], closures: [], unavailable: [] };
  for (const r of rows) {
    if (r.kind === 'RECEIVING' || r.kind === 'CONTACT') {
      if (r.dow == null || r.start_local == null || r.end_local == null) {
        throw new RangeError(`${r.kind} window needs dow/start_local/end_local`);
      }
      const w = { dow: r.dow, start_local: r.start_local, end_local: r.end_local };
      assertWindow(w);
      (r.kind === 'RECEIVING' ? out.receiving : out.contact).push(w);
    } else {
      if (r.starts_at == null || r.ends_at == null) throw new RangeError(`${r.kind} window needs starts_at/ends_at`);
      if (ms(r.ends_at) <= ms(r.starts_at)) throw new RangeError(`${r.kind} window ends before it starts`);
      (r.kind === 'CLOSURE' ? out.closures : out.unavailable).push({ starts_at: r.starts_at, ends_at: r.ends_at });
    }
  }
  return out;
}

/** zod schema for a JSON list of weekly windows (e.g. flo_contacts.contact_hours). */
export const weeklyWindowsSchema = z.array(
  z
    .object({
      dow: z.number().int().min(1).max(7),
      start_local: z.string().regex(TIME_RE),
      end_local: z.string().regex(TIME_RE),
    })
    .refine((w) => parseLocalTime(w.end_local) > parseLocalTime(w.start_local), {
      message: 'end_local must be after start_local',
    }),
);

/** Parse a jsonb contact/receiving hours value; null/undefined → null (unknown, not "never"). */
export function parseWeeklyWindows(json: unknown): WeeklyWindow[] | null {
  if (json == null) return null;
  return weeklyWindowsSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

/** Sort and merge overlapping or touching spans. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** spans − blocks (both half-open). */
export function subtractSpans(spans: readonly Span[], blocks: readonly Span[]): Span[] {
  const b = mergeSpans(blocks);
  const out: Span[] = [];
  for (const s of mergeSpans(spans)) {
    let cur = s.start;
    for (const k of b) {
      if (k.end <= cur || k.start >= s.end) continue;
      if (k.start > cur) out.push({ start: cur, end: k.start });
      cur = Math.max(cur, k.end);
      if (cur >= s.end) break;
    }
    if (cur < s.end) out.push({ start: cur, end: s.end });
  }
  return out;
}

const toSpans = (ws: readonly DatedWindow[]): Span[] => ws.map((w) => ({ start: ms(w.starts_at), end: ms(w.ends_at) }));

/** Instant spans of the weekly windows that fall on local `date`. */
export function windowsOnDate(date: string, windows: readonly WeeklyWindow[], tz: string = DEFAULT_TZ): Span[] {
  const dow = isoDow(date);
  const spans: Span[] = [];
  for (const w of windows) {
    if (w.dow !== dow) continue;
    const { start, end } = assertWindow(w);
    spans.push({ start: localInstant(date, start, tz), end: localInstant(date, end, tz) });
  }
  return mergeSpans(spans);
}

/** Open spans (weekly windows minus blocks) intersecting [from, to). */
export function openSpansBetween(
  from: Instant,
  to: Instant,
  windows: readonly WeeklyWindow[],
  tz: string = DEFAULT_TZ,
  blocks: readonly DatedWindow[] = [],
): Span[] {
  const a = ms(from);
  const b = ms(to);
  if (b <= a) return [];
  const spans: Span[] = [];
  // One day of margin on each side covers any tz offset.
  const last = addLocalDays(localDate(b, tz), 1);
  for (let d = addLocalDays(localDate(a, tz), -1); d <= last; d = addLocalDays(d, 1)) {
    for (const s of windowsOnDate(d, windows, tz)) {
      const start = Math.max(s.start, a);
      const end = Math.min(s.end, b);
      if (end > start) spans.push({ start, end });
    }
  }
  return subtractSpans(spans, toSpans(blocks));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** True when t falls inside a weekly window (start inclusive, end exclusive). */
export function isWithinWindows(t: Instant, windows: readonly WeeklyWindow[], tz: string = DEFAULT_TZ): boolean {
  const x = ms(t);
  return windowsOnDate(localDate(x, tz), windows, tz).some((s) => s.start <= x && x < s.end);
}

/** True when t falls inside any closure/unavailability [starts_at, ends_at). */
export function isBlockedAt(t: Instant, blocks: readonly DatedWindow[]): boolean {
  const x = ms(t);
  return blocks.some((w) => ms(w.starts_at) <= x && x < ms(w.ends_at));
}

/** Open = inside a weekly window and not inside any block. */
export function isOpenAt(
  t: Instant,
  windows: readonly WeeklyWindow[],
  tz: string = DEFAULT_TZ,
  blocks: readonly DatedWindow[] = [],
): boolean {
  return isWithinWindows(t, windows, tz) && !isBlockedAt(t, blocks);
}

/** Receiving is open at t: receiving hours, minus closures and manual unavailability. */
export function isReceivingOpenAt(t: Instant, availability: FloAvailability, tz: string = DEFAULT_TZ): boolean {
  return isOpenAt(t, availability.receiving, tz, [...availability.closures, ...availability.unavailable]);
}

/** Contact is reachable at t: contact hours minus manual unavailability. */
export function isContactOpenAt(t: Instant, availability: FloAvailability, tz: string = DEFAULT_TZ): boolean {
  return isOpenAt(t, availability.contact, tz, availability.unavailable);
}

/**
 * Elapsed time between a and b that lies inside contact hours (minus optional blocks), in
 * minutes (may be fractional). Out-of-hours time does not count (PRD §8 responsiveness).
 * Returns 0 when b <= a.
 */
export function contactMinutesBetween(
  a: Instant,
  b: Instant,
  windows: readonly WeeklyWindow[],
  tz: string = DEFAULT_TZ,
  blocks: readonly DatedWindow[] = [],
): number {
  const total = openSpansBetween(a, b, windows, tz, blocks).reduce((acc, s) => acc + (s.end - s.start), 0);
  return total / MINUTE_MS;
}

/**
 * Inverse of contactMinutesBetween: the earliest instant t >= start such that
 * contactMinutesBetween(start, t) == minutes. Returns null when no open time exists
 * within MAX_SEARCH_DAYS (e.g. no windows at all) — callers must not invent a deadline.
 * With minutes = 0 the result is `start` itself.
 */
export function addContactMinutes(
  start: Instant,
  minutes: number,
  windows: readonly WeeklyWindow[],
  tz: string = DEFAULT_TZ,
  blocks: readonly DatedWindow[] = [],
): Date | null {
  if (!(minutes >= 0) || !Number.isFinite(minutes)) throw new RangeError(`Invalid minutes: ${minutes}`);
  const a = ms(start);
  if (minutes === 0) return new Date(a);
  let remaining = minutes * MINUTE_MS;
  const blockSpans = toSpans(blocks);
  // Weekly windows never cross local midnight, so the search starts on start's local date.
  let d = localDate(a, tz);
  for (let i = 0; i <= MAX_SEARCH_DAYS; i++, d = addLocalDays(d, 1)) {
    const day = windowsOnDate(d, windows, tz);
    const open = subtractSpans(
      day.map((s) => ({ start: Math.max(s.start, a), end: s.end })).filter((s) => s.end > s.start),
      blockSpans,
    );
    for (const s of open) {
      const len = s.end - s.start;
      if (remaining <= len) return new Date(s.start + remaining);
      remaining -= len;
    }
  }
  return null;
}

/** Earliest instant >= t at which the windows are open (minus blocks), or null within the search bound. */
export function nextOpenAt(
  t: Instant,
  windows: readonly WeeklyWindow[],
  tz: string = DEFAULT_TZ,
  blocks: readonly DatedWindow[] = [],
): Date | null {
  const a = ms(t);
  const blockSpans = toSpans(blocks);
  let d = localDate(a, tz);
  for (let i = 0; i <= MAX_SEARCH_DAYS; i++, d = addLocalDays(d, 1)) {
    const day = windowsOnDate(d, windows, tz)
      .map((s) => ({ start: Math.max(s.start, a), end: s.end }))
      .filter((s) => s.end > s.start);
    const first = subtractSpans(day, blockSpans)[0];
    if (first) return new Date(first.start);
  }
  return null;
}

/** Dated blocks (closures) overlapping local date `date`. */
export function blocksOnDate(date: string, blocks: readonly DatedWindow[], tz: string = DEFAULT_TZ): DatedWindow[] {
  const start = localInstant(date, 0, tz);
  const end = localInstant(date, 86_400, tz);
  return blocks.filter((w) => ms(w.starts_at) < end && start < ms(w.ends_at));
}

/** True when merged blocks cover the whole local day [00:00, next 00:00). */
export function isDateFullyBlocked(date: string, blocks: readonly DatedWindow[], tz: string = DEFAULT_TZ): boolean {
  const day: Span = { start: localInstant(date, 0, tz), end: localInstant(date, 86_400, tz) };
  return subtractSpans([day], toSpans(blocks)).length === 0;
}
