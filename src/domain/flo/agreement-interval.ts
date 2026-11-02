/**
 * Agreement validity intervals and derived lifecycle (PRD §5, architecture A.1 0005).
 *
 * Stored form: local legal dates (valid_from_date, valid_through_date, inclusive) plus the
 * derived half-open instant interval [valid_from, valid_until_exclusive). "Valid through
 * 30 November WIB" ⇒ exclusive end = 1 December 00:00 WIB. A handover exactly at the
 * exclusive end is invalid.
 *
 * SQL parity (db/migrations/0005_agreements.sql, 0015_agreement_history_ordering.sql):
 *   - isValidAt                 ⇔ valid_from <= t AND t < valid_until_exclusive
 *   - effectiveUntil            ⇔ agreements.effective_until = least(valid_until_exclusive,
 *                                  superseded_from) — an approved successor caps the version
 *   - agreementValidAt          ⇔ lumbung.agreement_valid_at_for (APPROVED only, effective
 *                                  interval, ORDER BY valid_from DESC, id)
 *   - agreementWasValidAt       ⇔ lumbung.agreement_was_valid_at_for (historical: as recorded
 *                                  at t — REVOKED before revoked_at, capped/SUPERSEDED on the
 *                                  legal interval before superseded_at)
 *   - agreementStatus           ⇔ lumbung.agreement_status(a, t)
 *   - isExpiringSoon            ⇔ lumbung.agreement_is_expiring_soon(a, t, '30 days')
 *                                  (ACTIVE, not capped, valid_until_exclusive - t <= 30 days)
 *
 * Pure: no clock access. `t` is always passed in (tenant clock / injected now).
 */
import {
  DEFAULT_TZ,
  addLocalDays,
  endOfLocalDayExclusive,
  localDate,
  startOfLocalDay,
  type Instant,
} from '@/src/lib/tz';
import type { AgreementLifecycle, AgreementReviewState } from '@/src/shared/enums';

export const DAY_MS = 86_400_000;
/** Default EXPIRING_SOON window: at most 30 days left until the exclusive end. */
export const EXPIRING_SOON_MS = 30 * DAY_MS;
/** Default renewal reminder offsets (days before expiry), PRD §5. */
export const RENEWAL_OFFSETS_DAYS = [30, 14, 7] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ms(i: Instant): number {
  const d = i instanceof Date ? i : new Date(i);
  const v = d.getTime();
  if (Number.isNaN(v)) throw new RangeError(`Invalid instant: ${String(i)}`);
  return v;
}

// ---------------------------------------------------------------------------
// Interval math
// ---------------------------------------------------------------------------

export interface LocalDateRange {
  /** First valid local legal date, 'YYYY-MM-DD' (inclusive). */
  validFromDate: string;
  /** Last valid local legal date, 'YYYY-MM-DD' (inclusive). */
  validThroughDate: string;
}

/** Half-open instant interval [valid_from, valid_until_exclusive). */
export interface AgreementInterval {
  valid_from: Date;
  valid_until_exclusive: Date;
}

/** Interval-shaped input; instants may be Date, ISO string or epoch ms. */
export interface IntervalLike {
  valid_from: Instant;
  valid_until_exclusive: Instant;
}

/**
 * Local legal dates → stored instants: valid_from = validFromDate 00:00 local,
 * valid_until_exclusive = (validThroughDate + 1 day) 00:00 local.
 */
export function localDatesToInterval(range: LocalDateRange, tz: string = DEFAULT_TZ): AgreementInterval {
  const { validFromDate, validThroughDate } = range;
  if (!DATE_RE.test(validFromDate)) throw new RangeError(`Invalid validFromDate: ${validFromDate}`);
  if (!DATE_RE.test(validThroughDate)) throw new RangeError(`Invalid validThroughDate: ${validThroughDate}`);
  if (validThroughDate < validFromDate) {
    throw new RangeError(`validThroughDate ${validThroughDate} is before validFromDate ${validFromDate}`);
  }
  return {
    valid_from: startOfLocalDay(validFromDate, tz),
    valid_until_exclusive: endOfLocalDayExclusive(validThroughDate, tz),
  };
}

/**
 * How a document words its end date (PRD §5: store the interpretation used, never infer):
 *   THROUGH_INCLUSIVE  "berlaku sampai dengan 30 Nov" — the date is the last valid day
 *   UNTIL_EXCLUSIVE    "berakhir 1 Des"               — the date is the first invalid day
 */
export const END_DATE_INTERPRETATIONS = ['THROUGH_INCLUSIVE', 'UNTIL_EXCLUSIVE'] as const;
export type EndDateInterpretation = (typeof END_DATE_INTERPRETATIONS)[number];

/** Last valid local legal date implied by the document's end date and its interpretation (SQL parity: 0015 upload_agreement). */
export function lastValidDateFromDocument(documentEndDate: string, interpretation: EndDateInterpretation): string {
  if (!DATE_RE.test(documentEndDate)) throw new RangeError(`Invalid documentEndDate: ${documentEndDate}`);
  return interpretation === 'THROUGH_INCLUSIVE' ? documentEndDate : addLocalDays(documentEndDate, -1);
}

/**
 * Inverse of localDatesToInterval. Returns null if the instants are not local midnights in
 * `tz` (i.e. the stored interval does not correspond to whole local legal dates).
 */
export function intervalToLocalDates(interval: IntervalLike, tz: string = DEFAULT_TZ): LocalDateRange | null {
  const from = ms(interval.valid_from);
  const until = ms(interval.valid_until_exclusive);
  if (until <= from) return null;
  const validFromDate = localDate(from, tz);
  const untilDate = localDate(until, tz);
  if (startOfLocalDay(validFromDate, tz).getTime() !== from) return null;
  if (startOfLocalDay(untilDate, tz).getTime() !== until) return null;
  return { validFromDate, validThroughDate: addLocalDays(untilDate, -1) };
}

/**
 * True when the stored instants equal the local legal dates converted in `tz`
 * (the seed/DB invariant AGREEMENT_INTERVAL_MISMATCH checks the same thing).
 */
export function intervalMatchesLocalDates(
  interval: IntervalLike,
  range: LocalDateRange,
  tz: string = DEFAULT_TZ,
): boolean {
  const expected = localDatesToInterval(range, tz);
  return (
    ms(interval.valid_from) === expected.valid_from.getTime() &&
    ms(interval.valid_until_exclusive) === expected.valid_until_exclusive.getTime()
  );
}

/** Start-inclusive, end-exclusive membership: valid_from <= t < valid_until_exclusive. */
export function isValidAt(interval: IntervalLike, t: Instant): boolean {
  const x = ms(t);
  return ms(interval.valid_from) <= x && x < ms(interval.valid_until_exclusive);
}

/** Half-open intervals overlap iff a.from < b.until AND b.from < a.until (touching ≠ overlap). */
export function intervalsOverlap(a: IntervalLike, b: IntervalLike): boolean {
  return ms(a.valid_from) < ms(b.valid_until_exclusive) && ms(b.valid_from) < ms(a.valid_until_exclusive);
}

/**
 * Renewal reminder instants: `offset` days before the exclusive end, keeping the local
 * wall time of the end (00:00 local for date-derived intervals). Ordered by offset as given
 * (default 30, 14, 7 → earliest first).
 */
export function renewalDueDates(
  validUntilExclusive: Instant,
  opts: { offsetsDays?: readonly number[]; tz?: string } = {},
): { offset_days: number; due_at: Date }[] {
  const tz = opts.tz ?? DEFAULT_TZ;
  const offsets = opts.offsetsDays ?? RENEWAL_OFFSETS_DAYS;
  const until = ms(validUntilExclusive);
  const untilDate = localDate(until, tz);
  const wallOffset = until - startOfLocalDay(untilDate, tz).getTime();
  return offsets.map((offset) => {
    if (!Number.isInteger(offset) || offset <= 0) throw new RangeError(`Invalid renewal offset: ${offset}`);
    const dueDate = addLocalDays(untilDate, -offset);
    return { offset_days: offset, due_at: new Date(startOfLocalDay(dueDate, tz).getTime() + wallOffset) };
  });
}

// ---------------------------------------------------------------------------
// Per-agreement lifecycle (SQL parity)
// ---------------------------------------------------------------------------

export interface AgreementLike extends IntervalLike {
  id: string;
  review_state: AgreementReviewState;
  version?: number;
  valid_from_date?: string;
  valid_through_date?: string;
  revoked_at?: Instant | null;
  /** Start of the approved successor that capped this version (0015), if any. */
  superseded_from?: Instant | null;
  /** When that supersession was recorded. */
  superseded_at?: Instant | null;
}

/** When the version stops being in force: the legal exclusive end, or the successor's start if capped. */
export function effectiveUntil(a: AgreementLike): number {
  const until = ms(a.valid_until_exclusive);
  return a.superseded_from === null || a.superseded_from === undefined ? until : Math.min(until, ms(a.superseded_from));
}

/**
 * Derived lifecycle at t, mirroring lumbung.agreement_status(a, t):
 * non-APPROVED review states pass through; APPROVED → SCHEDULED | ACTIVE | SUPERSEDED (capped
 * by a successor, from its start on) | EXPIRED.
 * A PENDING_VERIFICATION renewal never becomes ACTIVE, whatever its interval (AC04).
 */
export function agreementStatus(a: AgreementLike, t: Instant): AgreementLifecycle {
  if (a.review_state !== 'APPROVED') return a.review_state;
  const x = ms(t);
  if (x < ms(a.valid_from)) return 'SCHEDULED';
  if (a.superseded_from !== null && a.superseded_from !== undefined && x >= ms(a.superseded_from)) return 'SUPERSEDED';
  if (x >= ms(a.valid_until_exclusive)) return 'EXPIRED';
  return 'ACTIVE';
}

/** EXPIRING_SOON badge: ACTIVE, not already renewed (capped), and valid_until_exclusive − t <= window (default 30 days). */
export function isExpiringSoon(a: AgreementLike, t: Instant, windowMs: number = EXPIRING_SOON_MS): boolean {
  return (
    agreementStatus(a, t) === 'ACTIVE' &&
    (a.superseded_from === null || a.superseded_from === undefined) &&
    ms(a.valid_until_exclusive) - ms(t) <= windowMs
  );
}

/** An agreement covers an instant (forward-looking) iff it is APPROVED and t is inside its effective interval. */
export function covers(a: AgreementLike, handoverAt: Instant): boolean {
  const x = ms(handoverAt);
  return a.review_state === 'APPROVED' && ms(a.valid_from) <= x && x < effectiveUntil(a);
}

/**
 * Historical coverage (parity with lumbung.agreement_was_valid_at_for): was an approved
 * agreement in force at t as recorded at that time? A later revocation or supersession
 * does not rewrite an earlier handover's validity (PRD §5).
 */
export function wasCovering(a: AgreementLike, t: Instant): boolean {
  if (a.review_state !== 'APPROVED' && a.review_state !== 'SUPERSEDED' && a.review_state !== 'REVOKED') return false;
  const x = ms(t);
  if (x < ms(a.valid_from)) return false;
  if (a.revoked_at !== null && a.revoked_at !== undefined && x >= ms(a.revoked_at)) return false;
  const capped = a.superseded_at !== null && a.superseded_at !== undefined && x >= ms(a.superseded_at);
  return x < (capped ? effectiveUntil(a) : ms(a.valid_until_exclusive));
}

const byValidFromDescThenId = (a: AgreementLike, b: AgreementLike): number => {
  const d = ms(b.valid_from) - ms(a.valid_from);
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * The APPROVED agreement valid at t (parity with lumbung.agreement_valid_at_for:
 * latest valid_from wins, then lowest id), or null. Callers pass one FLO's agreements.
 */
export function agreementValidAt<A extends AgreementLike>(agreements: readonly A[], t: Instant): A | null {
  const valid = agreements.filter((a) => covers(a, t));
  if (valid.length === 0) return null;
  return [...valid].sort(byValidFromDescThenId)[0];
}

/** Historical counterpart of agreementValidAt (parity with lumbung.agreement_was_valid_at_for). */
export function agreementWasValidAt<A extends AgreementLike>(agreements: readonly A[], t: Instant): A | null {
  const valid = agreements.filter((a) => wasCovering(a, t));
  if (valid.length === 0) return null;
  return [...valid].sort(byValidFromDescThenId)[0];
}

/** Overlapping APPROVED intervals of one FLO; they need explicit resolution (PRD §5). */
export interface AgreementOverlap<A extends AgreementLike = AgreementLike> {
  a: A;
  b: A;
  overlap_from: Date;
  overlap_until_exclusive: Date;
}

/**
 * All pairs of APPROVED agreements whose half-open intervals intersect. Deterministic
 * order: by (valid_from, id) of `a`, then of `b`. Adjacent intervals (a ends exactly when
 * b starts) do not overlap.
 */
export function findApprovedOverlaps<A extends AgreementLike>(agreements: readonly A[]): AgreementOverlap<A>[] {
  const approved = agreements
    .filter((a) => a.review_state === 'APPROVED')
    .sort((x, y) => ms(x.valid_from) - ms(y.valid_from) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const out: AgreementOverlap<A>[] = [];
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      const a = approved[i];
      const b = approved[j];
      // Effective intervals: a version capped by an approved successor no longer overlaps it.
      if (!(ms(a.valid_from) < effectiveUntil(b) && ms(b.valid_from) < effectiveUntil(a))) continue;
      out.push({
        a,
        b,
        overlap_from: new Date(Math.max(ms(a.valid_from), ms(b.valid_from))),
        overlap_until_exclusive: new Date(Math.min(effectiveUntil(a), effectiveUntil(b))),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// FLO-level summary (one FLO's agreements at t)
// ---------------------------------------------------------------------------

/**
 * FLO-level agreement status at t:
 *   ACTIVE                an APPROVED agreement is valid at t (EXPIRING_SOON is a badge flag)
 *   SCHEDULED             none valid at t, but an APPROVED one starts later (future renewal)
 *   REVOKED               none valid/scheduled; the latest started APPROVED|REVOKED record is REVOKED
 *   EXPIRED               none valid/scheduled; the latest started APPROVED|REVOKED record has ended
 *   PENDING_VERIFICATION  no approved history at all, only uploads awaiting review
 *   NONE                  nothing usable (no agreements, or only REJECTED/SUPERSEDED)
 *
 * Consistent with the seed classifier (architecture B.3): valid → ACTIVE/EXPIRING,
 * approved but none valid → EXPIRED, otherwise PENDING. A pending renewal is surfaced via
 * `pending_renewal`, never by changing validity (AC04).
 */
export type FloAgreementStatus = 'ACTIVE' | 'SCHEDULED' | 'REVOKED' | 'EXPIRED' | 'PENDING_VERIFICATION' | 'NONE';

/** Eligibility reason codes (PRD §6) relevant to agreements. */
export type AgreementEligibilityCode = 'AGREEMENT_EXPIRED' | 'AGREEMENT_REVOKED' | 'AGREEMENT_UNVERIFIED';

export interface FloAgreementSummary<A extends AgreementLike = AgreementLike> {
  status: FloAgreementStatus;
  /** Badge on ACTIVE only. */
  expiring_soon: boolean;
  /** APPROVED agreement valid at t, if any. */
  current: A | null;
  /** Earliest APPROVED agreement starting after t, if any. */
  scheduled: A | null;
  /** Latest started APPROVED|REVOKED record when nothing is valid at t. */
  previous: A | null;
  /** True when at least one PENDING_VERIFICATION upload exists. */
  pending_renewal: boolean;
  /** ms from t until `current` ends (null when not ACTIVE). */
  ms_until_end: number | null;
  /** Overlapping APPROVED intervals needing explicit resolution. */
  overlaps: AgreementOverlap<A>[];
  /**
   * Reason code for the "approved and valid now" eligibility check, or null when ACTIVE.
   * Pending renewal (or a scheduled future approval, or no agreement) → AGREEMENT_UNVERIFIED:
   * temporary, plannable but not offerable. Expired → AGREEMENT_EXPIRED. Revoked →
   * AGREEMENT_REVOKED (a pending renewal does not soften a revocation).
   */
  eligibility_code: AgreementEligibilityCode | null;
}

export function floAgreementStatus<A extends AgreementLike>(
  agreements: readonly A[],
  t: Instant,
  opts: { expiringSoonMs?: number } = {},
): FloAgreementSummary<A> {
  const x = ms(t);
  const overlaps = findApprovedOverlaps(agreements);
  const pending_renewal = agreements.some((a) => a.review_state === 'PENDING_VERIFICATION');
  const current = agreementValidAt(agreements, x);

  if (current) {
    return {
      status: 'ACTIVE',
      expiring_soon: isExpiringSoon(current, x, opts.expiringSoonMs ?? EXPIRING_SOON_MS),
      current,
      scheduled: earliestScheduled(agreements, x),
      previous: null,
      pending_renewal,
      ms_until_end: effectiveUntil(current) - x,
      overlaps,
      eligibility_code: null,
    };
  }

  const scheduled = earliestScheduled(agreements, x);
  const previous =
    agreements
      .filter((a) => (a.review_state === 'APPROVED' || a.review_state === 'REVOKED') && ms(a.valid_from) <= x)
      .sort(byValidFromDescThenId)[0] ?? null;

  let status: FloAgreementStatus;
  let eligibility_code: AgreementEligibilityCode;
  if (scheduled) {
    status = 'SCHEDULED';
    eligibility_code = 'AGREEMENT_UNVERIFIED';
  } else if (previous?.review_state === 'REVOKED') {
    status = 'REVOKED';
    eligibility_code = 'AGREEMENT_REVOKED';
  } else if (previous) {
    status = 'EXPIRED';
    eligibility_code = pending_renewal ? 'AGREEMENT_UNVERIFIED' : 'AGREEMENT_EXPIRED';
  } else if (pending_renewal) {
    status = 'PENDING_VERIFICATION';
    eligibility_code = 'AGREEMENT_UNVERIFIED';
  } else {
    status = 'NONE';
    eligibility_code = 'AGREEMENT_UNVERIFIED';
  }
  return {
    status,
    expiring_soon: false,
    current: null,
    scheduled,
    previous,
    pending_renewal,
    ms_until_end: null,
    overlaps,
    eligibility_code,
  };
}

function earliestScheduled<A extends AgreementLike>(agreements: readonly A[], x: number): A | null {
  return (
    agreements
      .filter((a) => a.review_state === 'APPROVED' && ms(a.valid_from) > x)
      .sort((p, q) => ms(p.valid_from) - ms(q.valid_from) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))[0] ?? null
  );
}

/**
 * Planning check for a future handover: an APPROVED agreement must cover `handoverAt`
 * AND an APPROVED agreement must be valid at `now` (PRD §5/§6 check 2). Returns the code
 * that blocks, or null when both hold.
 */
export function handoverAgreementCheck(
  agreements: readonly AgreementLike[],
  now: Instant,
  handoverAt: Instant,
): AgreementEligibilityCode | null {
  const summary = floAgreementStatus(agreements, now);
  if (summary.eligibility_code) return summary.eligibility_code;
  if (agreementValidAt(agreements, handoverAt)) return null;
  // Valid now but not at the handover: a pending renewal makes it plannable-only.
  return summary.pending_renewal ? 'AGREEMENT_UNVERIFIED' : 'AGREEMENT_EXPIRED';
}
