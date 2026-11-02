/**
 * Reporting part of step 5 (architecture B): BAST + RECEIPT_PHOTO obligations per
 * receipt, RECEIPT_PHOTO for dispatched-but-unreceived deliveries, 120 distribution
 * events (20 receipts × 2 + 80 × 1, preferring good/mixed reporters) each with a
 * DISTRIBUTION obligation, outcomes by reporting profile plus forced examples
 * (under review, excused, needs clarification, final rejection, late resubmission),
 * follow-up jobs and DISTRIBUTION_STATUS_UNKNOWN tasks. No scores are stored.
 */
import { sha256Hex } from '@/src/lib/hash';
import { formatQty } from '@/src/lib/qty';
import { shuffle, type Rng } from '@/src/lib/prng';
import { DAY, HOUR, MIN, intIn, iso, weightedSample, type Clock, type Ids, type Streams } from './config';
import type { Dataset, Row } from './dataset';
import type { FloInfo } from './flos';
import type { RefContext } from './reference';
import type { HistoryResult, ReceiptRecord } from './history';
import { addAudit } from './audit';

type ObType = 'BAST' | 'RECEIPT_PHOTO' | 'DISTRIBUTION';
type Outcome =
  | 'ON_TIME'
  | 'LATE'
  | 'MISSING'
  | 'UNDER_REVIEW'
  | 'EXCUSED'
  | 'NEEDS_CLARIFICATION'
  | 'REJECTED_FINAL'
  | 'RESUBMITTED_LATE'
  | 'OPEN_NOT_DUE';

interface Obligation {
  key: string;
  id: string;
  type: ObType;
  subjectType: 'DELIVERY' | 'DISTRIBUTION_EVENT';
  subjectId: string;
  anchorKind: string;
  anchorAt: number;
  dueIso: string;
  /** submitted_at < dueExcl ⇔ submitted_at <= due_at */
  dueExcl: number;
  dueRule: 'CALENDAR_NEXT_DAY_EOD' | 'AT_RECEIPT';
  reminderAt: number | null;
  createdAt: number;
  flo: FloInfo;
  outcome: Outcome;
}

export const FORCED_MINIMUMS = { UNDER_REVIEW: 10, EXCUSED: 6, NEEDS_CLARIFICATION: 5, REJECTED_FINAL: 3, RESUBMITTED_LATE: 4 } as const;

const PROFILE_P: Record<string, [number, number]> = {
  GOOD: [0.9, 0.97],
  MIXED: [0.6, 0.85],
  POOR: [0.35, 0.7],
  INSUFFICIENT: [0.5, 0.75],
};

export interface ReportingMeta {
  outcomes: Record<string, number>;
  distributionEvents: number;
  followupJobs: number;
  unknownTasks: number;
}

export function buildReporting(ds: Dataset, clock: Clock, ids: Ids, streams: Streams, ref: RefContext, hist: HistoryResult): ReportingMeta {
  const T = clock.now;
  const tz = clock.tz;
  const tenantId = ref.tenantId;
  const policyId = ref.policies['REPORTING-DEMO-1.0'];
  const reviewer = ref.users.REVIEW_EVD;
  const rDist = streams.get('reporting.distribution');
  const rOut = streams.get('reporting.outcomes');
  const rTimes = streams.get('reporting.times');
  const rForced = streams.get('reporting.forced');

  const obligations: Obligation[] = [];
  const addOb = (o: Omit<Obligation, 'id' | 'outcome'>) => obligations.push({ ...o, id: ids.id('obligation', o.key), outcome: 'OPEN_NOT_DUE' });

  // Delivery obligations ------------------------------------------------------
  const sortedReceipts = [...hist.receipts].sort((a, b) => a.receivedAt - b.receivedAt || (a.deliveryCode < b.deliveryCode ? -1 : 1));
  for (const r of sortedReceipts) {
    const due = clock.dueCalendar(r.dispatchedAt);
    addOb({
      key: `RECEIPT_PHOTO:${r.deliveryCode}`, type: 'RECEIPT_PHOTO', subjectType: 'DELIVERY', subjectId: r.deliveryId, anchorKind: 'DISPATCHED',
      anchorAt: r.dispatchedAt, dueIso: due.iso, dueExcl: due.exclusiveMs, dueRule: 'CALENDAR_NEXT_DAY_EOD', reminderAt: null,
      createdAt: r.dispatchedAt, flo: r.flo,
    });
    if (r.receivedAt >= due.exclusiveMs) throw new Error(`receipt after the photo deadline for ${r.deliveryCode}`);
    addOb({
      key: `BAST:${r.deliveryCode}`, type: 'BAST', subjectType: 'DELIVERY', subjectId: r.deliveryId, anchorKind: 'RECEIVED',
      anchorAt: r.receivedAt, dueIso: iso(r.receivedAt), dueExcl: r.receivedAt + 1, dueRule: 'AT_RECEIPT', reminderAt: r.receivedAt + 30 * MIN,
      createdAt: r.receivedAt, flo: r.flo,
    });
  }
  for (const d of hist.dispatches) {
    const due = clock.dueCalendar(d.dispatchedAt);
    addOb({
      key: `RECEIPT_PHOTO:${d.deliveryCode}`, type: 'RECEIPT_PHOTO', subjectType: 'DELIVERY', subjectId: d.deliveryId, anchorKind: 'DISPATCHED',
      anchorAt: d.dispatchedAt, dueIso: due.iso, dueExcl: due.exclusiveMs, dueRule: 'CALENDAR_NEXT_DAY_EOD', reminderAt: null,
      createdAt: d.dispatchedAt, flo: d.flo,
    });
  }

  // Distribution events ----------------------------------------------------------
  const weightOf = (r: ReceiptRecord) => (r.flo.reporting === 'GOOD' ? 3 : r.flo.reporting === 'MIXED' ? 2 : 1);
  const eligible = sortedReceipts.filter((r) => r.receivedAt <= T - DAY);
  const chosen = weightedSample(rDist, eligible, 100, weightOf);
  if (chosen.length !== 100) throw new Error('not enough receipts for 100 distributed receipts');
  const twoEvents = new Set(chosen.slice(0, 20).map((r) => r.receiptId));
  const distributed = new Set(chosen.map((r) => r.receiptId));
  let eventCount = 0;
  const floorInc = (q: bigint, inc: bigint) => q - (q % inc);
  const share = (q: bigint, lo: number, hi: number, rng: Rng, inc: bigint) =>
    floorInc((q * BigInt(Math.round((lo + (hi - lo) * rng()) * 1000))) / 1000n, inc);
  for (const r of sortedReceipts) {
    if (!distributed.has(r.receiptId)) continue;
    const n = twoEvents.has(r.receiptId) ? 2 : 1;
    const A = r.acceptedQty;
    const occ1 = Math.min(r.receivedAt + intIn(rDist, 2, 20) * HOUR, T - 2 * HOUR);
    const occ2 = Math.min(occ1 + intIn(rDist, 20, 40) * HOUR, T - HOUR);
    const people = Math.max(1, Math.round(r.flo.people * (0.7 + 0.3 * rDist())));
    let lines: { occurred: number; distributed: bigint; remaining: bigint; loss: bigint }[];
    if (n === 1) {
      const lossy = rDist() < 0.1;
      const remaining = share(A, 0, 0.1, rDist, r.increment);
      const loss = lossy ? share(A - remaining, 0.03, 0.06, rDist, r.increment) : 0n;
      lines = [{ occurred: occ1, distributed: A - remaining - loss, remaining, loss }];
    } else {
      const d1 = share(A, 0.5, 0.7, rDist, r.increment);
      const rem1 = A - d1;
      const d2 = share(rem1, 0.7, 1, rDist, r.increment);
      lines = [
        { occurred: occ1, distributed: d1, remaining: rem1, loss: 0n },
        { occurred: Math.max(occ2, occ1 + HOUR), distributed: d2, remaining: rem1 - d2, loss: 0n },
      ];
    }
    lines.forEach((l, k) => {
      const evKey = `${r.deliveryCode}:${k + 1}`;
      const eventId = ids.id('distribution_event', evKey);
      const reported = Math.min(l.occurred + intIn(rDist, 0, 8) * HOUR, T - 30 * MIN);
      ds.add('distribution_events', {
        id: eventId, tenant_id: tenantId, flo_id: r.flo.id, receipt_id: r.receiptId, occurred_at: iso(l.occurred),
        occurrence_time_source: 'FLO_REPORTED', reported_at: iso(reported), people_reported: k === 0 ? people : Math.round(people * 0.6),
        planned: true, created_at: iso(reported), updated_at: iso(reported),
      });
      ds.add('distribution_event_lines', {
        id: ids.id('distribution_event_line', evKey), tenant_id: tenantId, event_id: eventId, receipt_line_id: r.receiptLineId,
        distributed_qty: formatQty(l.distributed), remaining_qty_snapshot: formatQty(l.remaining), loss_disposed_qty: formatQty(l.loss),
        reported_consumed_qty: null, created_at: iso(reported),
      });
      eventCount++;
      const due = clock.dueCalendar(l.occurred);
      addOb({
        key: `DISTRIBUTION:${evKey}`, type: 'DISTRIBUTION', subjectType: 'DISTRIBUTION_EVENT', subjectId: eventId, anchorKind: 'DISTRIBUTED',
        anchorAt: l.occurred, dueIso: due.iso, dueExcl: due.exclusiveMs, dueRule: 'CALENDAR_NEXT_DAY_EOD', reminderAt: null,
        createdAt: reported, flo: r.flo,
      });
    });
  }
  if (eventCount !== 120) throw new Error(`expected 120 distribution events, got ${eventCount}`);

  // Base outcomes by reporting profile ------------------------------------------
  for (const o of obligations) {
    const u = rOut();
    if (o.dueExcl > T) {
      o.outcome = 'OPEN_NOT_DUE';
      continue;
    }
    const [pOn, pLate] = PROFILE_P[o.flo.reporting];
    o.outcome = u < pOn ? 'ON_TIME' : u < pLate ? 'LATE' : 'MISSING';
    if (o.outcome === 'LATE' && T - o.dueExcl < 2 * HOUR) o.outcome = 'ON_TIME';
  }

  // Forced examples -------------------------------------------------------------
  const forced = new Set<Obligation>();
  const force = (n: number, outcome: Outcome, pred: (o: Obligation) => boolean) => {
    const pool = shuffle(obligations.filter((o) => !forced.has(o) && o.outcome !== 'OPEN_NOT_DUE' && pred(o)), rForced);
    if (pool.length < n) throw new Error(`not enough obligations to force ${outcome}`);
    for (const o of pool.slice(0, n)) {
      o.outcome = outcome;
      forced.add(o);
    }
  };
  force(FORCED_MINIMUMS.UNDER_REVIEW, 'UNDER_REVIEW', (o) => o.type !== 'BAST' && o.dueExcl >= T - 3 * DAY && o.outcome !== 'MISSING');
  force(FORCED_MINIMUMS.NEEDS_CLARIFICATION, 'NEEDS_CLARIFICATION', (o) => o.type !== 'BAST' && o.dueExcl >= T - 7 * DAY && o.dueExcl <= T - 6 * HOUR);
  force(FORCED_MINIMUMS.RESUBMITTED_LATE, 'RESUBMITTED_LATE', (o) => o.type !== 'BAST' && o.dueExcl <= T - 2 * DAY && o.dueExcl >= T - 30 * DAY);
  force(FORCED_MINIMUMS.REJECTED_FINAL, 'REJECTED_FINAL', (o) => o.dueExcl <= T - 3 * DAY);
  const missingPool = obligations.filter((o) => !forced.has(o) && o.outcome === 'MISSING' && o.dueExcl <= T - 2 * DAY);
  force(FORCED_MINIMUMS.EXCUSED, 'EXCUSED', missingPool.length >= FORCED_MINIMUMS.EXCUSED
    ? (o) => o.outcome === 'MISSING' && o.dueExcl <= T - 2 * DAY
    : (o) => o.dueExcl <= T - 2 * DAY);

  // Emit ----------------------------------------------------------------------------
  const evidenceMedia: Row[] = [];
  const outcomes: Record<string, number> = {};
  const onTimeAt = (o: Obligation): number => {
    if (o.type === 'BAST') return o.anchorAt;
    const start = Math.max(o.anchorAt, o.createdAt);
    const end = Math.min(o.dueExcl, T);
    return start + Math.floor((end - start) * (0.05 + 0.85 * rTimes()));
  };
  const lateAt = (o: Obligation, after = o.dueExcl): number => {
    const lo = Math.max(after, o.dueExcl);
    return lo + Math.floor((T - 30 * MIN - lo) * (0.05 + 0.55 * rTimes()));
  };
  const reviewAt = (submitted: number, minM = 60, maxM = 2880): number | null => {
    const at = submitted + intIn(rTimes, minM, maxM) * MIN;
    if (at <= T - MIN) return at;
    const capped = T - intIn(rTimes, 1, 30) * MIN;
    return capped > submitted + MIN ? capped : null;
  };

  const addSubmission = (o: Obligation, version: number, submittedAt: number, supersedes: string | null): string => {
    const subKey = `${o.key}:v${version}`;
    const id = ids.id('submission', subKey);
    const mediaId = ids.id('media', `evidence:${subKey}`);
    const media = ds.add('media_files', {
      id: mediaId, tenant_id: tenantId, storage_key: `seed/evidence/${o.type.toLowerCase()}/${mediaId}.jpg`, sha256: sha256Hex(`media:${mediaId}`),
      mime: 'image/jpeg', bytes: 120_000 + (Number.parseInt(mediaId.slice(0, 6), 16) % 780_000), uploader_actor: null,
      uploaded_at: iso(submittedAt), captured_at: iso(Math.max(o.anchorAt, submittedAt - 20 * MIN)),
      sensitivity: o.type === 'DISTRIBUTION' ? 'SENSITIVE' : 'NORMAL', purpose: `EVIDENCE_${o.type}`,
      retention_until: iso(submittedAt + 90 * DAY), deletion_state: 'ACTIVE', duplicate_of_media_id: null,
      created_at: iso(submittedAt), updated_at: iso(submittedAt),
    });
    evidenceMedia.push(media);
    ds.add('evidence_submissions', {
      id, tenant_id: tenantId, obligation_id: o.id, version, submitted_at: iso(submittedAt), ingested_at: iso(submittedAt + 2000),
      time_source: 'FLO_LINK', channel: 'FLO_LINK', actor: null, note: version > 1 ? 'Foto pengganti yang lebih jelas' : null,
      supersedes_id: supersedes, created_at: iso(submittedAt + 2000),
    });
    ds.add('submission_files', {
      id: ids.id('submission_file', subKey), tenant_id: tenantId, submission_id: id, media_id: mediaId, created_at: iso(submittedAt + 2000),
    });
    return id;
  };
  const addReview = (o: Obligation, submissionId: string, version: number, at: number, outcome: 'ADEQUATE' | 'NEEDS_CLARIFICATION' | 'REJECTED_FINAL', comments: string | null) => {
    const key = `${o.key}:v${version}`;
    ds.add('evidence_reviews', {
      id: ids.id('review', key), tenant_id: tenantId, submission_id: submissionId, reviewer_id: reviewer, reviewed_at: iso(at), outcome,
      final: outcome !== 'NEEDS_CLARIFICATION', checklist: { relevant: outcome !== 'REJECTED_FINAL', association_ok: true, synthetic: true },
      comments, created_at: iso(at), created_by: reviewer,
    });
    addAudit(ds, ids, {
      key: `review:${key}`, actorId: reviewer, action: 'EVIDENCE_REVIEWED', subjectType: 'EVIDENCE_SUBMISSION', subjectId: submissionId,
      policyVersionId: policyId, at, payload: { obligation_type: o.type, outcome },
    });
  };

  for (const o of obligations) {
    let state = 'OPEN';
    let resolvedSubmission: string | null = null;
    let timeliness: string | null = null;
    let excuse: { category: string; explanation: string; at: number } | null = null;
    let updated = o.createdAt;
    let outcome = o.outcome;
    switch (outcome) {
      case 'ON_TIME':
      case 'LATE': {
        const at = outcome === 'ON_TIME' ? onTimeAt(o) : lateAt(o);
        const sub = addSubmission(o, 1, at, null);
        const rv = reviewAt(at);
        if (rv === null) {
          outcome = 'UNDER_REVIEW';
          state = 'UNDER_REVIEW';
          updated = at;
          break;
        }
        addReview(o, sub, 1, rv, 'ADEQUATE', null);
        state = 'ACCEPTED';
        resolvedSubmission = sub;
        timeliness = outcome;
        updated = rv;
        break;
      }
      case 'UNDER_REVIEW': {
        const at = onTimeAt(o);
        addSubmission(o, 1, at, null);
        state = 'UNDER_REVIEW';
        updated = at;
        break;
      }
      case 'NEEDS_CLARIFICATION': {
        const at = onTimeAt(o);
        const sub = addSubmission(o, 1, at, null);
        const rv = reviewAt(at, 30, 240) ?? at + MIN;
        addReview(o, sub, 1, rv, 'NEEDS_CLARIFICATION', 'Foto kurang jelas; mohon kirim foto yang menampilkan kegiatan dan jumlah makanan.');
        state = 'NEEDS_CLARIFICATION';
        updated = rv;
        break;
      }
      case 'REJECTED_FINAL': {
        const at = onTimeAt(o);
        const sub = addSubmission(o, 1, at, null);
        const rv = reviewAt(at, 120, 1440) ?? at + MIN;
        addReview(o, sub, 1, rv, 'REJECTED_FINAL', 'Bukti tidak terkait dengan pengiriman ini (simulasi).');
        state = 'REJECTED_FINAL';
        resolvedSubmission = sub;
        timeliness = 'MISSING';
        updated = rv;
        break;
      }
      case 'RESUBMITTED_LATE': {
        // SC08-like: unclear on-time photo, clarification, adequate replacement after the deadline → accepted LATE.
        const at1 = onTimeAt(o);
        const sub1 = addSubmission(o, 1, at1, null);
        const rv1 = reviewAt(at1, 60, 300) ?? at1 + MIN;
        addReview(o, sub1, 1, rv1, 'NEEDS_CLARIFICATION', 'Foto buram; mohon kirim ulang.');
        const at2 = lateAt(o, rv1 + HOUR);
        const sub2 = addSubmission(o, 2, at2, sub1);
        const rv2 = reviewAt(at2, 60, 600) ?? at2 + MIN;
        addReview(o, sub2, 2, rv2, 'ADEQUATE', 'Foto pengganti memadai; terlambat dari tenggat.');
        state = 'ACCEPTED';
        resolvedSubmission = sub2;
        timeliness = 'LATE';
        updated = rv2;
        break;
      }
      case 'EXCUSED': {
        const at = Math.min(o.dueExcl + DAY, T - HOUR);
        const cats = [
          ['PHONE_FAILURE', 'Ponsel PIC rusak; bukti tidak dapat dikirim (simulasi).'],
          ['NETWORK_OUTAGE', 'Gangguan jaringan di lokasi (simulasi).'],
          ['EMERGENCY_CLOSURE', 'Lokasi tutup darurat (simulasi).'],
        ] as const;
        const [category, explanation] = cats[intIn(rTimes, 0, cats.length - 1)];
        excuse = { category, explanation, at };
        state = 'EXCUSED';
        updated = at;
        addAudit(ds, ids, {
          key: `excuse:${o.key}`, actorId: reviewer, action: 'OBLIGATION_EXCUSED', subjectType: 'EVIDENCE_OBLIGATION', subjectId: o.id,
          policyVersionId: policyId, reason: explanation, at, payload: { category },
        });
        break;
      }
      case 'MISSING':
      case 'OPEN_NOT_DUE':
        state = 'OPEN';
        break;
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    ds.add('evidence_obligations', {
      id: o.id, tenant_id: tenantId, type: o.type, subject_type: o.subjectType, subject_id: o.subjectId, anchor_kind: o.anchorKind,
      anchor_at: iso(o.anchorAt), due_at: o.dueIso, reminder_at: o.reminderAt === null ? null : iso(o.reminderAt), due_rule: o.dueRule,
      timezone: tz, policy_version_id: policyId, state, resolved_submission_id: null, resolved_timeliness: timeliness,
      excuse_category: excuse?.category ?? null, excuse_explanation: excuse?.explanation ?? null, excused_by: excuse ? reviewer : null,
      excused_at: excuse ? iso(excuse.at) : null, revision: 1, created_at: iso(o.createdAt), updated_at: iso(Math.max(updated, o.createdAt)),
    });
    if (resolvedSubmission) ds.defer('evidence_obligations', 'resolved_submission_id', o.id, resolvedSubmission);
  }

  // Two exact-duplicate media hashes across different deliveries (AC33: flag only).
  const dupRng = streams.get('reporting.duplicates');
  const half = Math.floor(evidenceMedia.length / 2);
  const dupIdx = shuffle(Array.from({ length: evidenceMedia.length - half }, (_, x) => half + x), dupRng).slice(0, 2);
  const origIdx = shuffle(Array.from({ length: half }, (_, x) => x), dupRng).slice(0, 2);
  for (let k = 0; k < 2; k++) {
    const j = dupIdx[k];
    const i = origIdx[k];
    const dup = evidenceMedia[j];
    const orig = evidenceMedia[i];
    dup.sha256 = orig.sha256;
    dup.duplicate_of_media_id = orig.id;
    ds.add('tasks', {
      id: ids.id('task', `duplicate_evidence:${dup.id}`), tenant_id: tenantId, kind: 'DUPLICATE_EVIDENCE', subject_type: 'MEDIA',
      subject_id: dup.id as string, severity: 'LOW', state: 'OPEN', assignee_id: reviewer, due_at: null,
      dedup_key: `duplicate_evidence:${dup.id}`, payload: { media_id: dup.id, duplicate_of_media_id: orig.id, note: 'Hash identik; periksa manual, bukan vonis kecurangan' },
      resolved_at: null, resolution: null, revision: 1, created_at: dup.uploaded_at, updated_at: dup.uploaded_at,
    });
  }

  // Receipts without distribution: follow-ups (recent) and unknown-status tasks (older).
  let followupJobs = 0;
  for (const r of sortedReceipts) {
    if (distributed.has(r.receiptId) || r.receivedAt < T - 2 * DAY) continue;
    const dedup = `distribution_followup:${r.receiptId}`;
    ds.add('jobs', {
      id: ids.id('job', dedup), tenant_id: tenantId, kind: 'DISTRIBUTION_FOLLOWUP', subject_type: 'FLO_RECEIPT', subject_id: r.receiptId,
      dedup_key: dedup, payload: { receipt_id: r.receiptId, delivery_id: r.deliveryId, planned_distribution_at: iso(r.plannedDistributionAt) },
      run_at: iso(r.plannedDistributionAt), state: 'QUEUED', attempts: 0, max_attempts: 5, lease_owner: null, lease_expires_at: null,
      last_error: null, error_category: null, next_attempt_at: null, created_at: iso(r.receivedAt), updated_at: iso(r.receivedAt),
    });
    followupJobs++;
  }
  const olderPool = sortedReceipts.filter((r) => !distributed.has(r.receiptId) && r.receivedAt >= T - 20 * DAY && r.receivedAt <= T - 7 * DAY);
  const unknown = shuffle(olderPool, streams.get('reporting.unknown')).slice(0, 6);
  if (unknown.length !== 6) throw new Error('not enough older receipts for DISTRIBUTION_STATUS_UNKNOWN tasks');
  for (const r of unknown.sort((a, b) => a.receivedAt - b.receivedAt)) {
    const at = r.plannedDistributionAt + 24 * HOUR;
    const dedup = `distribution_unknown:${r.receiptId}`;
    ds.add('tasks', {
      id: ids.id('task', dedup), tenant_id: tenantId, kind: 'DISTRIBUTION_STATUS_UNKNOWN', subject_type: 'FLO_RECEIPT', subject_id: r.receiptId,
      severity: 'MEDIUM', state: 'OPEN', assignee_id: ref.users.KOORD1, due_at: iso(at + DAY), dedup_key: dedup,
      payload: { flo_code: r.flo.code, delivery_code: r.deliveryCode, planned_distribution_at: iso(r.plannedDistributionAt) },
      resolved_at: null, resolution: null, revision: 1, created_at: iso(at), updated_at: iso(at),
    });
  }

  return { outcomes, distributionEvents: eventCount, followupJobs, unknownTasks: unknown.length };
}
