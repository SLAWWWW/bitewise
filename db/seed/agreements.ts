/**
 * Step 3 (architecture B): agreement versions relative to the clock, renewal tasks,
 * document media, and the B.3 classifier (also implemented in SQL by the tests).
 *
 * Instants are derived from local legal dates in the tenant zone:
 * valid_from = from 00:00, valid_until_exclusive = (through + 1) 00:00.
 *
 * Mirrors the command path (migrations 0013/0015) so seeded history obeys the same rules
 * as live commands (PRD §24):
 *  - every seeded document records its end-date interpretation (THROUGH_INCLUSIVE);
 *  - an older version overlapped by a later-starting approved successor stays APPROVED
 *    and is capped at the successor's start (superseded_from/superseded_at), exactly what
 *    approve_agreement(..., 'SUPERSEDE_PREVIOUS') records — it is never erased;
 *  - renewal tasks are created like approve_agreement does: all of 30/14/7 for every
 *    approved version at approval time (including future due dates), OPEN until a
 *    successor is APPROVED (then DONE), linked to a pending upload when one exists.
 */
import { sha256Hex } from '@/src/lib/hash';
import { localDaysBetween } from '@/src/lib/tz';
import { shuffle, type Rng } from '@/src/lib/prng';
import { DAY, HOUR, intIn, iso, type Clock, type Ids, type Streams } from './config';
import type { Dataset } from './dataset';
import type { AgreementClass } from './marginals';
import type { FloInfo } from './flos';
import type { RefContext } from './reference';
import { addAudit } from './audit';

/** The fixture dates were written for the default clock (2026-10-26); shift them with the clock. */
const FIXTURE_BASE_DATE = '2026-10-26';

export interface AgreementRecord {
  id: string;
  floCode: string;
  version: number;
  state: 'PENDING_VERIFICATION' | 'APPROVED' | 'SUPERSEDED';
  fromDate: string;
  throughDate: string;
  from: number;
  /** Legal exclusive end. */
  until: number;
  /** Approval instant (null while pending). */
  reviewedMs: number | null;
  /** Start of the approved successor that capped this version, if any. */
  supersededFrom: number | null;
}

interface Supersession {
  /** Instant from which the successor replaces this version (successor.valid_from). */
  from: number;
  /** When the resolution was recorded (the successor's approval). */
  at: number;
  successorId: string;
}

/** B.3 classifier at instant t over APPROVED intervals of one FLO. */
export function classifyAgreement(approved: readonly { from: number; until: number }[], t: number): AgreementClass {
  const valid = approved.filter((a) => a.from <= t && t < a.until).sort((a, b) => b.from - a.from)[0];
  if (valid) return valid.until - t > 30 * DAY ? 'ACTIVE_GT30' : 'EXPIRING';
  return approved.length > 0 ? 'EXPIRED' : 'PENDING';
}

export function buildAgreements(ds: Dataset, clock: Clock, ids: Ids, streams: Streams, ref: RefContext, flos: FloInfo[]): AgreementRecord[] {
  const rng = streams.get('agreement.dates');
  const extraRng = streams.get('agreement.extras');
  const tenantId = ref.tenantId;
  const T = clock.now;
  const today = clock.today;
  const shiftDays = localDaysBetween(FIXTURE_BASE_DATE, today);
  const shifted = (d: string) => clock.addDays(d, shiftDays);
  const between = (r: Rng, a: number, b: number) => clock.addDays(today, intIn(r, a, b));
  const records: AgreementRecord[] = [];

  const reviewer = ref.users.REVIEW_AGR;
  const uploader = ref.users.KOORD1;

  function add(
    f: FloInfo,
    version: number,
    fromDate: string,
    throughDate: string,
    state: AgreementRecord['state'],
    uploadedMs: number,
    reviewedMs: number | null,
    supersedesId: string | null,
    superseded: Supersession | null = null,
  ): AgreementRecord {
    const id = ids.id('agreement', `${f.code}:v${version}`);
    const mediaId = ids.id('media', `agreement:${f.code}:v${version}`);
    const from = clock.dayStart(fromDate);
    const until = clock.dayStart(clock.addDays(throughDate, 1));
    ds.add('media_files', {
      id: mediaId, tenant_id: tenantId, storage_key: `seed/agreements/${f.code}-v${version}.pdf`, sha256: sha256Hex(`media:${mediaId}`),
      mime: 'application/pdf', bytes: 180_000 + ((version * 7919 + f.idx * 104_729) % 240_000), uploader_actor: uploader,
      uploaded_at: iso(uploadedMs), captured_at: null, sensitivity: 'NORMAL', purpose: 'AGREEMENT_DOCUMENT', retention_until: null,
      deletion_state: 'ACTIVE', duplicate_of_media_id: null, created_at: iso(uploadedMs), updated_at: iso(uploadedMs),
    });
    const reviewed = reviewedMs === null ? null : iso(reviewedMs);
    ds.add('agreements', {
      id, tenant_id: tenantId, flo_id: f.id, document_media_id: mediaId, version, signed_date: clock.addDays(fromDate, -3),
      valid_from_date: fromDate, valid_through_date: throughDate, valid_from: iso(from), valid_until_exclusive: iso(until),
      // Synthetic documents state "berlaku sampai dengan <through>" (inclusive last day).
      document_end_date: throughDate, end_date_interpretation: 'THROUGH_INCLUSIVE', interpretation_note: null,
      review_state: state, uploaded_by: uploader, reviewer_id: reviewed ? reviewer : null, reviewed_at: reviewed,
      revoked_at: null, revoke_reason: null, supersedes_id: supersedesId,
      superseded_from: superseded ? iso(superseded.from) : null, superseded_at: superseded ? iso(superseded.at) : null,
      revision: superseded ? 2 : 1,
      created_at: iso(uploadedMs), created_by: uploader, updated_at: superseded ? iso(superseded.at) : (reviewed ?? iso(uploadedMs)),
    });
    if (superseded) ds.defer('agreements', 'superseded_by_id', id, superseded.successorId);
    if (reviewedMs !== null) {
      addAudit(ds, ids, {
        key: `agreement:${f.code}:v${version}:approve`, actorId: reviewer, action: 'AGREEMENT_APPROVED', subjectType: 'AGREEMENT',
        subjectId: id, subjectRevision: 1, at: reviewedMs, payload: { flo_code: f.code, version, valid_from_date: fromDate, valid_through_date: throughDate },
      });
    }
    const rec: AgreementRecord = {
      id, floCode: f.code, version, state, fromDate, throughDate, from, until, reviewedMs, supersededFrom: superseded?.from ?? null,
    };
    records.push(rec);
    if (state === 'APPROVED') f.approved.push({ id, from, until: superseded ? Math.min(until, superseded.from) : until });
    return rec;
  }

  /** Renewal tasks exactly as approve_agreement creates them (30/14/7 before the legal end, due > valid_from). */
  function addRenewalTasks(
    f: FloInfo,
    a: AgreementRecord,
    outcome: { status: 'OPEN' | 'DONE'; submittedId: string | null; updatedMs: number },
  ): void {
    for (const offset of [30, 14, 7]) {
      const due = a.until - offset * DAY;
      if (due <= a.from) continue;
      ds.add('renewal_tasks', {
        id: ids.id('renewal_task', `${f.code}:v${a.version}:${offset}`), tenant_id: tenantId, agreement_id: a.id,
        offset_days: offset, due_at: iso(due), status: outcome.status, submitted_agreement_id: outcome.submittedId,
        created_at: iso(a.reviewedMs!), created_by: reviewer, updated_at: iso(outcome.updatedMs),
      });
    }
  }

  const reviewBefore = (fromDate: string, r: Rng) => clock.at(clock.addDays(fromDate, -intIn(r, 3, 12)), 10);

  // Which EXPIRED FLOs have an older SUPERSEDED version (~30%), EXPIRING FLOs with an
  // approved future renewal (3) and EXPIRED FLOs with a pending renewal (FLO-0008 + 3).
  const expiredNonFixture = flos.filter((f) => f.agreementClass === 'EXPIRED' && !f.fixture);
  const supersededSet = new Set(shuffle(expiredNonFixture, extraRng).slice(0, Math.round(expiredNonFixture.length * 0.3)).map((f) => f.idx));
  const expiringNonFixture = flos.filter((f) => f.agreementClass === 'EXPIRING' && !f.fixture);
  const approvedRenewalSet = new Set(shuffle(expiringNonFixture, extraRng).slice(0, 3).map((f) => f.idx));
  const pendingRenewalSet = new Set(shuffle(expiredNonFixture, extraRng).slice(0, 3).map((f) => f.idx));

  for (const f of flos) {
    const cls = f.agreementClass;
    // Draw all dates up-front so every FLO consumes the same number of draws.
    const dGt30Through = between(rng, 50, 370);
    const dGt30From = between(rng, -660, -120);
    const dExpiringThrough = between(rng, 1, 25);
    const dExpiringFrom = between(rng, -420, -120);
    const dExpiredThrough = between(rng, -67, -1);
    const dExpiredFrom = between(rng, -480, -120);
    const dPendingFrom = between(rng, -25, 5);
    const uploadDaysAgo = intIn(rng, 1, 20);

    let fromDate: string;
    let throughDate: string;
    if (cls === 'ACTIVE_GT30') {
      fromDate = dGt30From;
      throughDate = dGt30Through;
    } else if (cls === 'EXPIRING') {
      fromDate = dExpiringFrom;
      throughDate = f.fixture?.agreementThrough ? shifted(f.fixture.agreementThrough) : dExpiringThrough;
    } else if (cls === 'EXPIRED') {
      fromDate = dExpiredFrom;
      throughDate = f.fixture?.agreementThrough ? shifted(f.fixture.agreementThrough) : dExpiredThrough;
    } else {
      // PENDING: only a PENDING_VERIFICATION agreement.
      fromDate = dPendingFrom;
      throughDate = clock.addDays(dPendingFrom, 364);
      add(f, 1, fromDate, throughDate, 'PENDING_VERIFICATION', T - uploadDaysAgo * DAY - 3 * HOUR, null, null);
      continue;
    }

    let version = 1;
    let supersedes: string | null = null;
    // Draw order is fixed (v1 review, then current review) so the other streams never shift.
    let v1Plan: { from: string; through: string; reviewed: number } | null = null;
    if (cls === 'EXPIRED' && supersededSet.has(f.idx)) {
      const v1From = clock.addDays(fromDate, -400);
      v1Plan = { from: v1From, through: clock.addDays(fromDate, 30), reviewed: reviewBefore(v1From, rng) };
    }
    const reviewed = reviewBefore(fromDate, rng);
    if (v1Plan) {
      // v2 (from fromDate) overlaps v1's last 30 days and starts later: approve_agreement with
      // SUPERSEDE_PREVIOUS caps v1 at v2's start (TRUNCATED) — v1 stays APPROVED.
      const currentId = ids.id('agreement', `${f.code}:v2`);
      const capFrom = clock.dayStart(fromDate);
      const v1 = add(f, 1, v1Plan.from, v1Plan.through, 'APPROVED', v1Plan.reviewed - 2 * DAY, v1Plan.reviewed, null, {
        from: capFrom, at: reviewed, successorId: currentId,
      });
      addAudit(ds, ids, {
        key: `agreement:${f.code}:v1:supersede`, actorId: reviewer, action: 'AGREEMENT_SUPERSEDED', subjectType: 'AGREEMENT',
        subjectId: v1.id, subjectRevision: 2, at: reviewed,
        payload: { flo_code: f.code, superseded_by: currentId, resolution: 'SUPERSEDE_PREVIOUS', mode: 'TRUNCATED', effective_until: iso(capFrom) },
      });
      // v1's tasks were created at its approval and closed (renewed) by v2's approval.
      addRenewalTasks(f, v1, { status: 'DONE', submittedId: currentId, updatedMs: reviewed });
      supersedes = v1.id;
      version = 2;
    }
    const current = add(f, version, fromDate, throughDate, 'APPROVED', reviewed - 2 * DAY, reviewed, supersedes);

    // Renewals.
    let renewal: AgreementRecord | null = null;
    if (cls === 'EXPIRING' && approvedRenewalSet.has(f.idx)) {
      const rFrom = clock.addDays(throughDate, 1);
      const rReviewed = T - intIn(rng, 2, 6) * DAY;
      renewal = add(f, version + 1, rFrom, clock.addDays(throughDate, 365), 'APPROVED', rReviewed - DAY, rReviewed, null);
    } else if (cls === 'EXPIRED' && (f.fixture?.pendingRenewal || pendingRenewalSet.has(f.idx))) {
      const rFrom = clock.addDays(throughDate, 1);
      renewal = add(f, version + 1, rFrom, clock.addDays(throughDate, 365), 'PENDING_VERIFICATION', T - 5 * DAY - 2 * HOUR, null, null);
    }

    // Renewal tasks of the current version: DONE only once a successor is APPROVED; a pending
    // upload is linked but leaves them OPEN (upload_agreement); future due dates included.
    if (renewal?.state === 'APPROVED') {
      addRenewalTasks(f, current, { status: 'DONE', submittedId: renewal.id, updatedMs: renewal.reviewedMs! });
      addRenewalTasks(f, renewal, { status: 'OPEN', submittedId: null, updatedMs: renewal.reviewedMs! });
    } else if (renewal) {
      addRenewalTasks(f, current, { status: 'OPEN', submittedId: renewal.id, updatedMs: T - 5 * DAY - 2 * HOUR });
    } else {
      addRenewalTasks(f, current, { status: 'OPEN', submittedId: null, updatedMs: reviewed });
    }
  }

  // Post-assert: the classifier reproduces every assigned class.
  for (const f of flos) {
    const got = classifyAgreement(f.approved, T);
    if (got !== f.agreementClass) throw new Error(`Agreement class mismatch for ${f.code}: ${got} != ${f.agreementClass}`);
  }
  return records;
}

/** Is the FLO covered by an APPROVED agreement at instant t (effective intervals)? */
export function agreementValidAt(f: FloInfo, t: number): boolean {
  return f.approved.some((a) => a.from <= t && t < a.until);
}
