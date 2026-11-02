/**
 * Ringkasan (operations dashboard) read model — Stage 1 surface (PRD §16 "Operations
 * dashboard"). Every number comes from a real query against the tenant's data under
 * RLS; nothing is static. Later-stage queues are rendered as "Tahap berikutnya"
 * placeholders by the page and have no query here on purpose.
 *
 * All time comparisons use the tenant clock (`lumbung.tenant_now()`), never the web
 * server's clock. Agreement validity uses the same half-open interval
 * [valid_from, valid_until_exclusive) as the SQL eligibility rule (migration 0005).
 *
 * Call inside `withTx(actorCtx(actor), ...)`.
 */
import type { Queryable } from '@/src/db/types';
import { FLO_AGREEMENT_STATUS_CASE, floAgreementLaterals } from '@/src/application/flo/agreement-status-sql';
import type { ClockMode } from '@/src/shared/enums';

/**
 * Per-FLO agreement bucket at tenant time T — exactly the FLO directory's status
 * (shared SQL: src/application/flo/agreement-status-sql.ts), so both screens agree:
 *  - ACTIVE     an APPROVED agreement is in force at T and is not expiring soon
 *  - EXPIRING   in force at T and ends within 30 days (directory: EXPIRING_SOON)
 *  - SCHEDULED  none in force at T, but an APPROVED agreement starts after T
 *  - EXPIRED    none in force; the latest started record is APPROVED (it ended)
 *  - REVOKED    none in force; the latest started record was REVOKED (SC06/AC17)
 *  - PENDING    no approved history; a PENDING_VERIFICATION upload exists
 *  - NONE       nothing usable
 * On the seed this equals the AC01 classifier (ACTIVE_GT30 / EXPIRING / EXPIRED / PENDING).
 */
export const FLO_AGREEMENT_BUCKETS = ['ACTIVE', 'EXPIRING', 'SCHEDULED', 'EXPIRED', 'REVOKED', 'PENDING', 'NONE'] as const;
export type FloAgreementBucket = (typeof FLO_AGREEMENT_BUCKETS)[number];

/** Expiry window for "needs review" — matches lumbung.agreement_is_expiring_soon's default. */
export const EXPIRING_WINDOW_DAYS = 30;

export interface ReviewItem {
  /** REVOKED: the FLO's latest agreement was revoked and nothing replaces it (open AGREEMENT_REVOKED task). */
  kind: 'PENDING' | 'EXPIRING' | 'REVOKED';
  agreement_id: string;
  flo_id: string;
  flo_code: string;
  flo_name: string;
  version: number;
  valid_from_date: string;
  valid_through_date: string;
  valid_until_exclusive: string;
  /** EXPIRING only: is a renewal waiting for verification? (PENDING rows: null) */
  renewal_state: 'PENDING' | 'NONE' | null;
  /** Exact target: the FLO's agreement page. */
  href: string;
}

export interface RenewalItem {
  task_id: string;
  agreement_id: string;
  flo_id: string;
  flo_code: string;
  flo_name: string;
  offset_days: number;
  due_at: string;
  /** Legal last day of the agreement (local date). */
  valid_through_date: string;
  valid_until_exclusive: string;
  href: string;
}

export interface DashboardSnapshot {
  /** ISO instant of tenant_now(). */
  now: string;
  clockMode: ClockMode | null;
  flo: { total: number; byBucket: Record<FloAgreementBucket, number> };
  review: {
    pendingTotal: number;
    expiringTotal: number;
    revokedTotal: number;
    items: ReviewItem[];
  };
  renewals: { dueTotal: number; upcomingTotal: number; items: RenewalItem[] };
}

/** Exact link for an agreement task (W2-FLO page `app/(ops)/flo/[id]/perjanjian`, id = flos.id). */
export function agreementHref(floId: string): string {
  return `/flo/${encodeURIComponent(floId)}/perjanjian`;
}

/**
 * `cur(flo_id, cur_id, cur_until)`: the APPROVED agreement of each FLO in force at T ($1),
 * i.e. valid_from <= T < effective_until (the legal exclusive end, or the start of an
 * approved successor that capped it — migration 0015), latest valid_from first, then id —
 * the exact predicate and tie-break of `lumbung.agreement_valid_at_for`.
 * Inlined as a set-based lateral join (one pass over all FLOs instead of one
 * `agreement_valid_at()` call per FLO; migration 0013 made that function app-callable);
 * tests/db/shell-read-models.test.ts asserts parity with the SQL function.
 */
export const CURRENT_AGREEMENT_CTE = `cur AS (
       SELECT f.id AS flo_id, v.id AS cur_id, v.valid_until_exclusive AS cur_until
         FROM lumbung.flos f
         LEFT JOIN LATERAL (
           SELECT a.id, a.valid_until_exclusive
             FROM lumbung.agreements a
            WHERE a.flo_id = f.id
              AND a.review_state = 'APPROVED'
              AND a.valid_from <= $1::timestamptz
              AND $1::timestamptz < a.effective_until
            ORDER BY a.valid_from DESC, a.id
            LIMIT 1
         ) v ON true
     )`;

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

export interface DashboardOptions {
  /** Max review rows (pending + expiring) to return. Default 12. */
  reviewLimit?: number;
  /** Max renewal rows to return. Default 8. */
  renewalLimit?: number;
}

export async function loadDashboard(c: Queryable, opts: DashboardOptions = {}): Promise<DashboardSnapshot> {
  const reviewLimit = Math.max(1, opts.reviewLimit ?? 12);
  const renewalLimit = Math.max(1, opts.renewalLimit ?? 8);

  const clock = await c.query<{ now: Date; mode: ClockMode | null }>(
    `SELECT lumbung.tenant_now() AS now,
            (SELECT k.mode FROM lumbung.tenant_clocks k WHERE k.tenant_id = lumbung.current_tenant()) AS mode`,
  );
  const now = clock.rows[0].now;

  // FLO buckets at T ($1): the directory's derivation, EXPIRING_SOON shown as EXPIRING.
  const buckets = await c.query<{ bucket: FloAgreementBucket; n: number }>(
    `SELECT CASE s.status WHEN 'EXPIRING_SOON' THEN 'EXPIRING' ELSE s.status END AS bucket, count(*)::int AS n
       FROM (SELECT ${FLO_AGREEMENT_STATUS_CASE} AS status
               FROM lumbung.flos f
               ${floAgreementLaterals('f', '$1::timestamptz')}) s
      GROUP BY 1`,
    [now],
  );
  const byBucket = Object.fromEntries(FLO_AGREEMENT_BUCKETS.map((b) => [b, 0])) as Record<FloAgreementBucket, number>;
  let total = 0;
  for (const r of buckets.rows) {
    byBucket[r.bucket] = r.n;
    total += r.n;
  }

  // Agreements needing review: FLOs whose latest agreement was REVOKED (nothing replaces
  // it), PENDING_VERIFICATION documents, plus the currently valid agreement of a FLO when it
  // ends within the window and no APPROVED successor starts at/after T (a renewal already
  // approved means nothing is left to review).
  const review = await c.query<{
    kind: 'PENDING' | 'EXPIRING' | 'REVOKED';
    agreement_id: string;
    flo_id: string;
    flo_code: string;
    flo_name: string;
    version: number;
    valid_from_date: string;
    valid_through_date: string;
    valid_until_exclusive: Date;
    renewal_state: 'PENDING' | 'NONE' | null;
    total_pending: number;
    total_expiring: number;
    total_revoked: number;
  }>(
    `WITH ${CURRENT_AGREEMENT_CTE},
     pending AS (
       SELECT 'PENDING'::text AS kind, a.id AS agreement_id, a.flo_id, a.version, a.valid_from_date,
              a.valid_through_date, a.valid_until_exclusive, NULL::text AS renewal_state
         FROM lumbung.agreements a
        WHERE a.review_state = 'PENDING_VERIFICATION'
     ),
     expiring AS (
       SELECT 'EXPIRING'::text AS kind, a.id AS agreement_id, a.flo_id, a.version, a.valid_from_date,
              a.valid_through_date, a.valid_until_exclusive,
              CASE WHEN EXISTS (SELECT 1 FROM lumbung.agreements p
                                 WHERE p.flo_id = a.flo_id AND p.review_state = 'PENDING_VERIFICATION')
                   THEN 'PENDING' ELSE 'NONE' END AS renewal_state
         FROM cur
         JOIN lumbung.agreements a ON a.id = cur.cur_id
        WHERE a.valid_until_exclusive - $1::timestamptz <= make_interval(days => $2::int)
          AND NOT EXISTS (SELECT 1 FROM lumbung.agreements s
                           WHERE s.flo_id = a.flo_id AND s.review_state = 'APPROVED'
                             AND s.id <> a.id AND s.valid_from > $1::timestamptz)
     ),
     revoked AS (
       -- FLOs whose bucket is REVOKED (same derivation as the directory): the revoked record.
       SELECT 'REVOKED'::text AS kind, lastd.id AS agreement_id, f.id AS flo_id, lastd.version, lastd.valid_from_date,
              lastd.valid_through_date, lastd.valid_until_exclusive, NULL::text AS renewal_state
         FROM lumbung.flos f
         ${floAgreementLaterals('f', '$1::timestamptz')}
        WHERE ${FLO_AGREEMENT_STATUS_CASE} = 'REVOKED'
     ),
     all_items AS (SELECT * FROM revoked UNION ALL SELECT * FROM pending UNION ALL SELECT * FROM expiring)
     SELECT i.kind, i.agreement_id, i.flo_id, f.code AS flo_code, f.name AS flo_name, i.version,
            i.valid_from_date, i.valid_through_date, i.valid_until_exclusive, i.renewal_state,
            (SELECT count(*)::int FROM pending) AS total_pending,
            (SELECT count(*)::int FROM expiring) AS total_expiring,
            (SELECT count(*)::int FROM revoked) AS total_revoked
       FROM all_items i
       JOIN lumbung.flos f ON f.id = i.flo_id
      ORDER BY CASE i.kind WHEN 'REVOKED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,
               i.valid_until_exclusive, f.code COLLATE "C", i.agreement_id
      LIMIT $3`,
    [now, EXPIRING_WINDOW_DAYS, reviewLimit],
  );

  // reviewLimit >= 1, so no rows means all totals are 0.
  const pendingTotal = review.rows[0]?.total_pending ?? 0;
  const expiringTotal = review.rows[0]?.total_expiring ?? 0;
  const revokedTotal = review.rows[0]?.total_revoked ?? 0;

  const renewals = await c.query<{
    task_id: string;
    agreement_id: string;
    flo_id: string;
    flo_code: string;
    flo_name: string;
    offset_days: number;
    due_at: Date;
    valid_through_date: string;
    valid_until_exclusive: Date;
    due_total: number;
    upcoming_total: number;
  }>(
    `WITH open AS (
       SELECT rt.id AS task_id, rt.agreement_id, rt.offset_days, rt.due_at, a.flo_id, a.valid_through_date,
              a.valid_until_exclusive
         FROM lumbung.renewal_tasks rt
         JOIN lumbung.agreements a ON a.id = rt.agreement_id
        WHERE rt.status = 'OPEN'
     ),
     due AS (SELECT * FROM open WHERE due_at <= $1::timestamptz)
     SELECT d.task_id, d.agreement_id, d.flo_id, f.code AS flo_code, f.name AS flo_name, d.offset_days,
            d.due_at, d.valid_through_date, d.valid_until_exclusive,
            (SELECT count(*)::int FROM due) AS due_total,
            (SELECT count(*)::int FROM open WHERE due_at > $1::timestamptz) AS upcoming_total
       FROM due d
       JOIN lumbung.flos f ON f.id = d.flo_id
      ORDER BY d.due_at, f.code COLLATE "C", d.offset_days, d.task_id
      LIMIT $2`,
    [now, renewalLimit],
  );
  let dueTotal = renewals.rows[0]?.due_total ?? 0;
  let upcomingTotal = renewals.rows[0]?.upcoming_total ?? 0;
  if (renewals.rows.length === 0) {
    const r = await c.query<{ upcoming: number }>(
      `SELECT count(*)::int AS upcoming FROM lumbung.renewal_tasks WHERE status = 'OPEN' AND due_at > $1::timestamptz`,
      [now],
    );
    dueTotal = 0;
    upcomingTotal = r.rows[0].upcoming;
  }

  return {
    now: iso(now),
    clockMode: clock.rows[0].mode,
    flo: { total, byBucket },
    review: {
      pendingTotal,
      expiringTotal,
      revokedTotal,
      items: review.rows.map((r) => ({
        kind: r.kind,
        agreement_id: r.agreement_id,
        flo_id: r.flo_id,
        flo_code: r.flo_code,
        flo_name: r.flo_name,
        version: r.version,
        valid_from_date: r.valid_from_date,
        valid_through_date: r.valid_through_date,
        valid_until_exclusive: iso(r.valid_until_exclusive),
        renewal_state: r.renewal_state,
        href: agreementHref(r.flo_id),
      })),
    },
    renewals: {
      dueTotal,
      upcomingTotal,
      items: renewals.rows.map((r) => ({
        task_id: r.task_id,
        agreement_id: r.agreement_id,
        flo_id: r.flo_id,
        flo_code: r.flo_code,
        flo_name: r.flo_name,
        offset_days: r.offset_days,
        due_at: iso(r.due_at),
        valid_through_date: r.valid_through_date,
        valid_until_exclusive: iso(r.valid_until_exclusive),
        href: agreementHref(r.flo_id),
      })),
    },
  };
}
