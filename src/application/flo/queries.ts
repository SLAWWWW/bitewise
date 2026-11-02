/**
 * FLO read models (W2-FLO). Every function takes a transaction client opened by
 * `withTx` with the actor's context, so RLS scopes every row to the tenant (another
 * tenant's FLO simply does not exist here → callers answer 404).
 *
 * Nothing scored is stored (architecture B.5 "Not stored: R, E, N…"). The directory
 * and detail derive, at the tenant clock (`lumbung.tenant_now()`):
 *  - agreement status via the SQL helpers agreement_status / agreement_is_expiring_soon
 *  - need state of the latest CONFIRMED assessment (fresh = unexpired and ≤ 30 days old)
 *  - R = (timely + 2) / (eligible + 4) from offers (PRD §8)
 *  - E = 0.4·BAST + 0.3·RECEIPT_PHOTO + 0.3·DISTRIBUTION, each (Σperf + 2) / (n + 4),
 *    perf 1 on-time accepted, 0.5 late accepted, 0 missing / final inadequate; open
 *    not-due, pending review, clarification and excused obligations are excluded.
 * A FLO without samples therefore shows 0.50 with sample count 0 ("insufficient
 * history"), never a red zero.
 */
import 'server-only';
import type { QueryResult } from 'pg';
import type { Queryable } from '@/src/db/types';
import { DomainError } from '@/src/db/errors';
import { decodeCursor, encodeCursor } from '@/src/http/pagination';
import { isUuid } from '@/src/lib/uuidv5';
import { FLO_AGREEMENT_STATUS_CASE, floAgreementLaterals } from './agreement-status-sql';
import {
  NEED_BAND_THRESHOLDS,
  RESPONSE_BAND_THRESHOLDS,
  type AgreementSummaryStatus,
  type FloListFilters,
  type NeedBand,
  type ResponseBand,
} from './schemas';
import { revealContact } from './contacts';

export const OBLIGATION_TYPES = ['BAST', 'RECEIPT_PHOTO', 'DISTRIBUTION'] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];
export const REPORTING_WEIGHTS: Record<ObligationType, number> = { BAST: 0.4, RECEIPT_PHOTO: 0.3, DISTRIBUTION: 0.3 };

/** PRD §8 smoothing: (x + 2) / (n + 4). Used for display of per-type values. */
export function smoothed(sum: number, n: number): number {
  return (sum + 2) / (n + 4);
}

export type NeedState = 'CONFIRMED' | 'STALE' | 'MISSING';

export interface FloListRow {
  id: string;
  code: string;
  name: string;
  flo_type: 'PANTI' | 'NON_PANTI';
  area: string;
  status: 'ACTIVE' | 'PAUSED';
  tenure: 'NEW' | 'ESTABLISHED';
  revision: number;
  location_confidence: string;
  primary_cluster: { id: string; code: string; name: string } | null;
  people_per_event: number | null;
  count_basis: string | null;
  schedule_verified: boolean | null;
  agreement: {
    status: AgreementSummaryStatus;
    /** Local legal date (WIB), inclusive, of the interval the status refers to. */
    valid_through_date: string | null;
    valid_from_date: string | null;
    /** ISO instant of the exclusive end. */
    valid_until_exclusive: string | null;
    has_pending_version: boolean;
  };
  need: {
    state: NeedState;
    band: NeedBand;
    score: string | null;
    category_code: string | null;
    assessed_at: string | null;
    expires_at: string | null;
    proposed_pending: number;
  };
  response: { eligible: number; timely: number; excluded: number; value: number; band: ResponseBand };
  reporting: {
    n: number;
    value: number;
    by_type: Record<ObligationType, { n: number; sum: number; value: number }>;
  };
}

export interface FloListResult {
  now: string;
  timezone: string;
  items: FloListRow[];
  next_cursor: string | null;
  total: number;
  /** Counts per derived agreement status over the whole directory (unfiltered). */
  agreement_counts: Record<AgreementSummaryStatus, number>;
  tenant_total: number;
}

// ── SQL ───────────────────────────────────────────────────────────────────────

/**
 * Per-obligation performance at the tenant clock (one implementation, used by the
 * directory and the detail page). `perf` NULL = excluded from the denominator.
 */
const OBLIGATION_PERF_CTE = `
  obl AS (
    SELECT coalesce(d.destination_flo_id, de.flo_id) AS flo_id, eo.id, eo.type, eo.state, eo.anchor_at, eo.due_at,
           eo.resolved_timeliness,
           CASE
             WHEN eo.state = 'EXCUSED' THEN NULL
             WHEN eo.state = 'ACCEPTED' THEN CASE
               WHEN eo.resolved_timeliness = 'ON_TIME' THEN 1.0
               WHEN eo.resolved_timeliness = 'LATE' THEN 0.5
               WHEN eo.resolved_timeliness = 'MISSING' THEN 0.0
               WHEN es.submitted_at IS NOT NULL THEN CASE WHEN es.submitted_at <= eo.due_at THEN 1.0 ELSE 0.5 END
               ELSE NULL END
             WHEN eo.state = 'REJECTED_FINAL' THEN 0.0
             WHEN eo.resolved_timeliness = 'MISSING' THEN 0.0
             WHEN eo.state = 'OPEN' AND eo.due_at < n.t THEN 0.0
             ELSE NULL
           END::float8 AS perf
      FROM lumbung.evidence_obligations eo
      CROSS JOIN n
      LEFT JOIN lumbung.deliveries d
             ON eo.subject_type = 'DELIVERY' AND d.tenant_id = eo.tenant_id AND d.id = eo.subject_id
      LEFT JOIN lumbung.distribution_events de
             ON eo.subject_type = 'DISTRIBUTION_EVENT' AND de.tenant_id = eo.tenant_id AND de.id = eo.subject_id
      LEFT JOIN lumbung.evidence_submissions es
             ON es.tenant_id = eo.tenant_id AND es.id = eo.resolved_submission_id
     WHERE eo.anchor_at <= n.t
  )`;

const NOW_CTE = `
  n AS (
    SELECT lumbung.tenant_now() AS t,
           (SELECT tn.timezone FROM lumbung.tenants tn WHERE tn.id = lumbung.current_tenant()) AS tz
  )`;

const BASE_SQL = `
WITH ${NOW_CTE},
  resp AS (
    SELECT o.flo_id,
           count(*) FILTER (WHERE o.r_eligible AND o.r_exclusion IS NULL)::int AS eligible,
           count(*) FILTER (WHERE o.r_eligible AND o.r_exclusion IS NULL AND o.r_timely)::int AS timely,
           count(*) FILTER (WHERE o.r_exclusion IS NOT NULL)::int AS excluded
      FROM lumbung.offers o CROSS JOIN n
     WHERE coalesce(o.sent_at, o.queued_at, o.created_at) <= n.t
     GROUP BY o.flo_id
  ),
  ${OBLIGATION_PERF_CTE},
  rep AS (
    SELECT flo_id,
           count(perf) FILTER (WHERE type = 'BAST')::int AS n_bast,
           coalesce(sum(perf) FILTER (WHERE type = 'BAST'), 0)::float8 AS s_bast,
           count(perf) FILTER (WHERE type = 'RECEIPT_PHOTO')::int AS n_rp,
           coalesce(sum(perf) FILTER (WHERE type = 'RECEIPT_PHOTO'), 0)::float8 AS s_rp,
           count(perf) FILTER (WHERE type = 'DISTRIBUTION')::int AS n_dist,
           coalesce(sum(perf) FILTER (WHERE type = 'DISTRIBUTION'), 0)::float8 AS s_dist
      FROM obl GROUP BY flo_id
  ),
  base AS (
    SELECT f.id, f.code, f.name, f.flo_type, f.area, f.status, f.tenure, f.revision, f.location_confidence,
           pc.id AS cluster_id, pc.code AS cluster_code, pc.name AS cluster_name,
           ss.people_per_event, ss.count_basis, (ss.verified_count IS NOT NULL) AS schedule_verified,
           ${FLO_AGREEMENT_STATUS_CASE} AS agreement_status,
           coalesce(cur.valid_from_date, sch.valid_from_date, lastd.valid_from_date) AS agreement_from_date,
           coalesce(cur.valid_through_date, sch.valid_through_date, lastd.valid_through_date) AS agreement_through_date,
           coalesce(cur.valid_until_exclusive, sch.valid_until_exclusive, lastd.valid_until_exclusive) AS agreement_until,
           pend.cnt > 0 AS agreement_pending,
           nd.score AS need_score, nd.category_code AS need_category, nd.assessed_at AS need_assessed_at,
           nd.expires_at AS need_expires_at,
           CASE WHEN nd.score IS NULL THEN 'MISSING' WHEN nd.fresh THEN 'CONFIRMED' ELSE 'STALE' END AS need_state,
           np.cnt AS need_proposed,
           coalesce(r.eligible, 0) AS r_eligible, coalesce(r.timely, 0) AS r_timely, coalesce(r.excluded, 0) AS r_excluded,
           (coalesce(r.timely, 0) + 2)::float8 / (coalesce(r.eligible, 0) + 4) AS r_value,
           coalesce(rp.n_bast, 0) AS n_bast, coalesce(rp.s_bast, 0) AS s_bast,
           coalesce(rp.n_rp, 0) AS n_rp, coalesce(rp.s_rp, 0) AS s_rp,
           coalesce(rp.n_dist, 0) AS n_dist, coalesce(rp.s_dist, 0) AS s_dist,
           0.4 * (coalesce(rp.s_bast, 0) + 2) / (coalesce(rp.n_bast, 0) + 4)
             + 0.3 * (coalesce(rp.s_rp, 0) + 2) / (coalesce(rp.n_rp, 0) + 4)
             + 0.3 * (coalesce(rp.s_dist, 0) + 2) / (coalesce(rp.n_dist, 0) + 4) AS e_value
      FROM lumbung.flos f
      CROSS JOIN n
      LEFT JOIN LATERAL (
        SELECT c.id, c.code, c.name
          FROM lumbung.flo_clusters fc
          JOIN lumbung.clusters c ON c.tenant_id = fc.tenant_id AND c.id = fc.cluster_id
         WHERE fc.tenant_id = f.tenant_id AND fc.flo_id = f.id AND fc.is_primary
         LIMIT 1) pc ON true
      LEFT JOIN LATERAL (
        SELECT s.people_per_event, s.count_basis, s.verified_count
          FROM lumbung.service_schedules s
         WHERE s.tenant_id = f.tenant_id AND s.flo_id = f.id
           AND s.effective_from <= (n.t AT TIME ZONE n.tz)::date
           AND (s.effective_to_excl IS NULL OR s.effective_to_excl > (n.t AT TIME ZONE n.tz)::date)
         ORDER BY s.effective_from DESC, s.id
         LIMIT 1) ss ON true
${floAgreementLaterals('f', 'n.t')}
      LEFT JOIN LATERAL (
        SELECT na.score, na.assessed_at, na.expires_at, c.code AS category_code,
               (na.expires_at > n.t AND na.assessed_at >= n.t - interval '30 days') AS fresh
          FROM lumbung.need_assessments na
          JOIN lumbung.categories c ON c.tenant_id = na.tenant_id AND c.id = na.category_id
         WHERE na.tenant_id = f.tenant_id AND na.flo_id = f.id AND na.status = 'CONFIRMED' AND na.assessed_at <= n.t
         ORDER BY na.assessed_at DESC, na.seq DESC
         LIMIT 1) nd ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS cnt FROM lumbung.need_assessments na
         WHERE na.tenant_id = f.tenant_id AND na.flo_id = f.id AND na.status = 'PROPOSED' AND na.expires_at > n.t) np ON true
      LEFT JOIN resp r ON r.flo_id = f.id
      LEFT JOIN rep rp ON rp.flo_id = f.id
  )`;

interface BaseRow {
  id: string;
  code: string;
  name: string;
  flo_type: 'PANTI' | 'NON_PANTI';
  area: string;
  status: 'ACTIVE' | 'PAUSED';
  tenure: 'NEW' | 'ESTABLISHED';
  revision: number;
  location_confidence: string;
  cluster_id: string | null;
  cluster_code: string | null;
  cluster_name: string | null;
  people_per_event: number | null;
  count_basis: string | null;
  schedule_verified: boolean | null;
  agreement_status: AgreementSummaryStatus;
  agreement_from_date: string | null;
  agreement_through_date: string | null;
  agreement_until: Date | null;
  agreement_pending: boolean;
  need_score: string | null;
  need_category: string | null;
  need_assessed_at: Date | null;
  need_expires_at: Date | null;
  need_state: NeedState;
  need_proposed: number;
  r_eligible: number;
  r_timely: number;
  r_excluded: number;
  r_value: number;
  n_bast: number;
  s_bast: number;
  n_rp: number;
  s_rp: number;
  n_dist: number;
  s_dist: number;
  e_value: number;
}

export function needBandOf(state: NeedState, score: string | null): NeedBand {
  if (state === 'MISSING' || score === null) return 'MISSING';
  if (state === 'STALE') return 'STALE';
  const s = Number(score);
  if (s >= NEED_BAND_THRESHOLDS.high) return 'HIGH';
  if (s >= NEED_BAND_THRESHOLDS.medium) return 'MEDIUM';
  return 'LOW';
}

export function responseBandOf(eligible: number, value: number): ResponseBand {
  if (eligible === 0) return 'INSUFFICIENT';
  if (value >= RESPONSE_BAND_THRESHOLDS.high) return 'HIGH';
  if (value >= RESPONSE_BAND_THRESHOLDS.medium) return 'MEDIUM';
  return 'LOW';
}

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

function toListRow(r: BaseRow): FloListRow {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    flo_type: r.flo_type,
    area: r.area,
    status: r.status,
    tenure: r.tenure,
    revision: r.revision,
    location_confidence: r.location_confidence,
    primary_cluster: r.cluster_id ? { id: r.cluster_id, code: r.cluster_code!, name: r.cluster_name! } : null,
    people_per_event: r.people_per_event,
    count_basis: r.count_basis,
    schedule_verified: r.people_per_event === null ? null : r.schedule_verified,
    agreement: {
      status: r.agreement_status,
      valid_from_date: r.agreement_from_date,
      valid_through_date: r.agreement_through_date,
      valid_until_exclusive: iso(r.agreement_until),
      has_pending_version: r.agreement_pending,
    },
    need: {
      state: r.need_state,
      band: needBandOf(r.need_state, r.need_score),
      score: r.need_score,
      category_code: r.need_category,
      assessed_at: iso(r.need_assessed_at),
      expires_at: iso(r.need_expires_at),
      proposed_pending: r.need_proposed,
    },
    response: {
      eligible: r.r_eligible,
      timely: r.r_timely,
      excluded: r.r_excluded,
      value: r.r_value,
      band: responseBandOf(r.r_eligible, r.r_value),
    },
    reporting: {
      n: r.n_bast + r.n_rp + r.n_dist,
      value: r.e_value,
      by_type: {
        BAST: { n: r.n_bast, sum: r.s_bast, value: smoothed(r.s_bast, r.n_bast) },
        RECEIPT_PHOTO: { n: r.n_rp, sum: r.s_rp, value: smoothed(r.s_rp, r.n_rp) },
        DISTRIBUTION: { n: r.n_dist, sum: r.s_dist, value: smoothed(r.s_dist, r.n_dist) },
      },
    },
  };
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const EMPTY_COUNTS = (): Record<AgreementSummaryStatus, number> => ({
  ACTIVE: 0,
  EXPIRING_SOON: 0,
  SCHEDULED: 0,
  EXPIRED: 0,
  PENDING: 0,
  REVOKED: 0,
  NONE: 0,
});

/**
 * Filtered, keyset-paginated directory (stable order: code COLLATE "C", id).
 * `ids` restricts to specific FLOs (used by the detail page for its summary).
 */
export async function listFlos(
  c: Queryable,
  filters: FloListFilters & { ids?: string[] } = {},
  page: { cursor?: string; limit?: number } = {},
): Promise<FloListResult> {
  const limit = page.limit ?? 50;
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = [];
  if (filters.ids) where.push(`b.id = ANY(${p(filters.ids)}::uuid[])`);
  if (filters.area) where.push(`b.area = ${p(filters.area)}`);
  if (filters.type) where.push(`b.flo_type = ${p(filters.type)}`);
  if (filters.status) where.push(`b.status = ${p(filters.status)}`);
  if (filters.cluster) {
    where.push(
      `EXISTS (SELECT 1 FROM lumbung.flo_clusters fc WHERE fc.flo_id = b.id AND fc.cluster_id = ${p(filters.cluster)}::uuid)`,
    );
  }
  if (filters.agreement) where.push(`b.agreement_status = ${p(filters.agreement)}`);
  if (filters.need) {
    const hi = () => `${p(NEED_BAND_THRESHOLDS.high)}::numeric`;
    const mid = () => `${p(NEED_BAND_THRESHOLDS.medium)}::numeric`;
    const band = filters.need;
    where.push(
      band === 'HIGH'
        ? `(b.need_state = 'CONFIRMED' AND b.need_score >= ${hi()})`
        : band === 'MEDIUM'
          ? `(b.need_state = 'CONFIRMED' AND b.need_score >= ${mid()} AND b.need_score < ${hi()})`
          : band === 'LOW'
            ? `(b.need_state = 'CONFIRMED' AND b.need_score < ${mid()})`
            : band === 'STALE'
              ? `b.need_state = 'STALE'`
              : `b.need_state = 'MISSING'`,
    );
  }
  if (filters.response) {
    const hi = () => `${p(RESPONSE_BAND_THRESHOLDS.high)}::float8`;
    const mid = () => `${p(RESPONSE_BAND_THRESHOLDS.medium)}::float8`;
    const band = filters.response;
    where.push(
      band === 'HIGH'
        ? `(b.r_eligible > 0 AND b.r_value >= ${hi()})`
        : band === 'MEDIUM'
          ? `(b.r_eligible > 0 AND b.r_value >= ${mid()} AND b.r_value < ${hi()})`
          : band === 'LOW'
            ? `(b.r_eligible > 0 AND b.r_value < ${mid()})`
            : `b.r_eligible = 0`,
    );
  }
  if (filters.q) {
    const pat = p(likePattern(filters.q));
    where.push(`(b.name ILIKE ${pat} OR b.code ILIKE ${pat})`);
  }
  let cursorCond = '';
  if (page.cursor) {
    const [code, id] = decodeCursor(page.cursor);
    if (typeof code !== 'string' || !isUuid(id)) {
      throw new DomainError({ code: 'BAD_REQUEST', message: 'Invalid cursor', field_errors: { cursor: ['Invalid cursor'] } });
    }
    cursorCond = `WHERE (y.code COLLATE "C" > ${p(code)} COLLATE "C" OR (y.code = $${params.length} AND y.id > ${p(id)}::uuid))`;
  }
  const limitParam = p(limit + 1);

  const sql = `${BASE_SQL},
  filtered AS (
    SELECT b.*, count(*) OVER () AS total FROM base b ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  ),
  counts AS (SELECT agreement_status, count(*)::int AS cnt FROM base GROUP BY agreement_status)
  SELECT y.*, (SELECT n.t FROM n) AS now_t, (SELECT n.tz FROM n) AS tz,
         (SELECT coalesce(jsonb_object_agg(agreement_status, cnt), '{}'::jsonb) FROM counts) AS agreement_counts,
         (SELECT count(*)::int FROM base) AS tenant_total
    FROM filtered y
    ${cursorCond}
   ORDER BY y.code COLLATE "C", y.id
   LIMIT ${limitParam}`;

  const res = await c.query<BaseRow & { total: string; now_t: Date; tz: string; agreement_counts: Record<string, number>; tenant_total: number }>(
    sql,
    params,
  );
  let meta = res.rows[0];
  if (!meta) {
    // No rows on this page: still report the clock and the directory counts.
    const m = await c.query<{ now_t: Date; tz: string; agreement_counts: Record<string, number>; tenant_total: number; total: number }>(
      `${BASE_SQL},
       counts AS (SELECT agreement_status, count(*)::int AS cnt FROM base GROUP BY agreement_status)
       SELECT (SELECT n.t FROM n) AS now_t, (SELECT n.tz FROM n) AS tz,
              (SELECT coalesce(jsonb_object_agg(agreement_status, cnt), '{}'::jsonb) FROM counts) AS agreement_counts,
              (SELECT count(*)::int FROM base) AS tenant_total`,
    );
    meta = { ...m.rows[0], total: '0' } as unknown as typeof meta;
  }
  const rows = res.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    now: new Date(meta.now_t).toISOString(),
    timezone: meta.tz ?? 'Asia/Jakarta',
    items: rows.map(toListRow),
    next_cursor: res.rows.length > limit && last ? encodeCursor(last.code, last.id) : null,
    total: res.rows.length ? Number(res.rows[0].total) : 0,
    agreement_counts: { ...EMPTY_COUNTS(), ...meta.agreement_counts },
    tenant_total: meta.tenant_total,
  };
}

// ── Reference lists for filters / forms ─────────────────────────────────────

export interface ClusterRef {
  id: string;
  code: string;
  name: string;
  area: string;
}

export async function listClusters(c: Queryable): Promise<ClusterRef[]> {
  const r = await c.query<ClusterRef>(
    `SELECT id, code, name, area FROM lumbung.clusters ORDER BY area COLLATE "C", name COLLATE "C", id`,
  );
  return r.rows;
}

export interface CategoryRef {
  id: string;
  code: string;
  name_id: string;
  name_en: string;
  comparable_unit: string;
}

export async function listCategories(c: Queryable): Promise<CategoryRef[]> {
  const r = await c.query<CategoryRef>(
    `SELECT id, code, name_id, name_en, comparable_unit FROM lumbung.categories ORDER BY code COLLATE "C"`,
  );
  return r.rows;
}

// ── Detail ────────────────────────────────────────────────────────────────────

export interface FloContactView {
  id: string;
  channel: string;
  /** Masked hint, always present. */
  address_hint: string;
  /** Clear address, only for flo.edit holders (null otherwise or if undecryptable). */
  address: string | null;
  decrypt_failed: boolean;
  role: string | null;
  verification_state: string;
  consent_state: string;
  opted_out_at: string | null;
  contact_hours: unknown;
}

export interface AgreementVersion {
  id: string;
  version: number;
  review_state: string;
  /** Derived at the tenant clock: PENDING_VERIFICATION | REJECTED | REVOKED | SUPERSEDED | SCHEDULED | ACTIVE | EXPIRED */
  status: string;
  expiring_soon: boolean;
  document_media_id: string | null;
  signed_date: string | null;
  valid_from_date: string;
  valid_through_date: string;
  /** End date as written in the document and how it was read (null = not recorded, pre-0015 rows). */
  document_end_date: string | null;
  end_date_interpretation: 'THROUGH_INCLUSIVE' | 'UNTIL_EXCLUSIVE' | null;
  interpretation_note: string | null;
  valid_from: string;
  valid_until_exclusive: string;
  /** When this version stops being in force: the legal exclusive end, or the start of an approved successor (0015). */
  effective_until: string;
  superseded_from: string | null;
  superseded_at: string | null;
  uploaded_by_name: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  supersedes_id: string | null;
  revision: number;
  created_at: string;
}

export interface RenewalTaskView {
  id: string;
  agreement_id: string;
  agreement_version: number;
  offset_days: number;
  due_at: string;
  status: string;
  submitted_agreement_id: string | null;
  submitted_version: number | null;
}

export interface OpenTaskView {
  id: string;
  kind: string;
  subject_type: string | null;
  subject_id: string | null;
  severity: string;
  state: string;
  due_at: string | null;
  payload: Record<string, unknown>;
}

export interface HistoryRow {
  category_id: string;
  category_code: string;
  category_name_id: string;
  category_name_en: string;
  comparable_unit: string;
  /** null when the category has no receipts at all (preferred / demanded category). */
  unit: string | null;
  comparable: boolean;
  qty_7d: string;
  qty_30d: string;
  rejected_30d: string;
  direct_30d: string;
  warehouse_30d: string;
  receipts_30d: number;
  last_received_at: string | null;
}

export interface RecentReceipt {
  receipt_line_id: string;
  delivery_code: string;
  route: string;
  category_code: string;
  unit: string;
  accepted_qty: string;
  rejected_qty: string;
  discrepancy_reason: string | null;
  received_at: string;
}

export interface ReportingTypeStats {
  type: ObligationType;
  weight: number;
  n: number;
  sum: number;
  value: number;
  on_time: number;
  late: number;
  missing: number;
  pending_review: number;
  open_not_due: number;
  excused: number;
  period_from: string | null;
  period_to: string | null;
}

export interface AuditView {
  id: string;
  occurred_at: string;
  action: string;
  actor_kind: string;
  actor_name: string | null;
  subject_type: string;
  subject_id: string | null;
  subject_revision: number | null;
  reason: string | null;
  payload: Record<string, unknown>;
  correlation_id: string | null;
}

export interface FloDetail {
  now: string;
  timezone: string;
  summary: FloListRow;
  profile: {
    id: string;
    code: string;
    name: string;
    flo_type: 'PANTI' | 'NON_PANTI';
    service_model: string;
    status: 'ACTIVE' | 'PAUSED';
    address: string | null;
    area: string;
    lat: string | null;
    lng: string | null;
    location_confidence: string;
    cooking_capable: boolean;
    storage_capabilities: string[];
    halal_required: boolean;
    allergen_exclusions: string[];
    tenure: 'NEW' | 'ESTABLISHED';
    revision: number;
    created_at: string;
    updated_at: string;
  };
  clusters: { id: string; code: string; name: string; area: string; is_primary: boolean }[];
  contacts: FloContactView[];
  contacts_revealed: boolean;
  category_prefs: { category_id: string; category_code: string; preference: string }[];
  schedules: {
    id: string;
    effective_from: string;
    effective_to_excl: string | null;
    service_dows: number[];
    people_per_event: number;
    count_basis: string;
    declared_count: number | null;
    verified_count: number | null;
    verified_by_name: string | null;
    verified_at: string | null;
    evidence_media_id: string | null;
    current: boolean;
  }[];
  demands: {
    id: string;
    category_code: string;
    unit: string;
    basis: string;
    quantity: string;
    valid_from: string;
    valid_to_excl: string | null;
    confidence: string;
    status: string;
    assessor_name: string | null;
    confirmed_by_name: string | null;
  }[];
  capacities: {
    id: string;
    category_code: string;
    unit: string;
    per_event_capacity: string | null;
    distribution_capacity: string | null;
    confirmed_at: string | null;
    confirmed_by_name: string | null;
  }[];
  availability: {
    id: string;
    kind: string;
    dow: number | null;
    start_local: string | null;
    end_local: string | null;
    starts_at: string | null;
    ends_at: string | null;
  }[];
  needs: {
    id: string;
    category_id: string;
    category_code: string;
    score: string;
    basis: string | null;
    requested_qty: string | null;
    unit: string | null;
    intended_distribution_date: string | null;
    available_stock_qty: string | null;
    expected_deliveries_qty: string | null;
    existing_support: string | null;
    assessor_name: string | null;
    assessed_at: string;
    expires_at: string;
    status: string;
    confirmed_by_name: string | null;
    /** FRESH | STALE | EXPIRED (confirmed) or PENDING | EXPIRED (proposed) */
    freshness: string;
  }[];
  history: HistoryRow[];
  recent_receipts: RecentReceipt[];
  responsiveness: {
    eligible: number;
    timely: number;
    excluded: number;
    value: number;
    period_from: string | null;
    period_to: string | null;
  };
  reporting: { value: number; n: number; by_type: ReportingTypeStats[] };
  agreements: AgreementVersion[];
  renewal_tasks: RenewalTaskView[];
  open_tasks: OpenTaskView[];
  audit: AuditView[] | null;
}

export interface GetFloOptions {
  /** Decrypt contact addresses (only for flo.edit holders). */
  revealContacts?: boolean;
  /** Include audit events (only for audit.read holders). */
  includeAudit?: boolean;
  auditLimit?: number;
}

type QueryThunk = () => Promise<QueryResult>;

/** Run queries one after another on the same client; results in input order. */
async function sequential<T extends QueryThunk[]>(thunks: [...T]): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const th of thunks) out.push(await th());
  return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

/** Full FLO detail, or null when the id is not a visible FLO of the tenant. */
export async function getFlo(c: Queryable, id: string, opts: GetFloOptions = {}): Promise<FloDetail | null> {
  if (!isUuid(id)) return null;
  const pr = await c.query(
    `SELECT f.id, f.code, f.name, f.flo_type, f.service_model, f.status, f.address, f.area, f.lat, f.lng,
            f.location_confidence, f.cooking_capable, f.storage_capabilities, f.halal_required, f.allergen_exclusions,
            f.tenure, f.revision, f.created_at, f.updated_at, f.tenant_id
       FROM lumbung.flos f WHERE f.id = $1`,
    [id],
  );
  const f = pr.rows[0];
  if (!f) return null;

  const summaryRes = await listFlos(c, { ids: [id] }, { limit: 1 });
  const summary = summaryRes.items[0];
  if (!summary) return null;
  const now = summaryRes.now;

  // One client = one connection: run the queries sequentially (pg deprecates overlapping client.query).
  const [clusters, contacts, prefs, schedules, demands, capacities, availability, needs] = await sequential([
    () => c.query(
      `SELECT c.id, c.code, c.name, c.area, fc.is_primary
         FROM lumbung.flo_clusters fc JOIN lumbung.clusters c ON c.tenant_id = fc.tenant_id AND c.id = fc.cluster_id
        WHERE fc.flo_id = $1 ORDER BY fc.is_primary DESC, c.name COLLATE "C", c.id`,
      [id],
    ),
    () => c.query(
      `SELECT id, channel, address_hint, address_ciphertext, role, verification_state, consent_state, opted_out_at, contact_hours
         FROM lumbung.flo_contacts WHERE flo_id = $1 ORDER BY channel COLLATE "C", created_at, id`,
      [id],
    ),
    () => c.query(
      `SELECT p.category_id, c.code AS category_code, p.preference
         FROM lumbung.flo_category_prefs p JOIN lumbung.categories c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
        WHERE p.flo_id = $1 ORDER BY c.code COLLATE "C"`,
      [id],
    ),
    () => c.query(
      `SELECT s.id, s.effective_from, s.effective_to_excl, s.service_dows, s.people_per_event, s.count_basis,
              s.declared_count, s.verified_count, vu.display_name AS verified_by_name, s.verified_at, s.evidence_media_id,
              (s.effective_from <= (lumbung.tenant_now() AT TIME ZONE t.timezone)::date
               AND (s.effective_to_excl IS NULL OR s.effective_to_excl > (lumbung.tenant_now() AT TIME ZONE t.timezone)::date)) AS current
         FROM lumbung.service_schedules s
         JOIN lumbung.tenants t ON t.id = s.tenant_id
         LEFT JOIN lumbung.users vu ON vu.id = s.verified_by
        WHERE s.flo_id = $1 ORDER BY s.effective_from DESC, s.id`,
      [id],
    ),
    () => c.query(
      `SELECT d.id, c.code AS category_code, d.unit, d.basis, d.quantity, d.valid_from, d.valid_to_excl, d.confidence,
              d.status, au.display_name AS assessor_name, cu.display_name AS confirmed_by_name
         FROM lumbung.category_demands d
         JOIN lumbung.categories c ON c.tenant_id = d.tenant_id AND c.id = d.category_id
         LEFT JOIN lumbung.users au ON au.id = d.assessor_id
         LEFT JOIN lumbung.users cu ON cu.id = d.confirmed_by
        WHERE d.flo_id = $1 ORDER BY c.code COLLATE "C", d.valid_from DESC, d.id`,
      [id],
    ),
    () => c.query(
      `SELECT k.id, c.code AS category_code, k.unit, k.per_event_capacity, k.distribution_capacity, k.confirmed_at,
              cu.display_name AS confirmed_by_name
         FROM lumbung.flo_category_capacities k
         JOIN lumbung.categories c ON c.tenant_id = k.tenant_id AND c.id = k.category_id
         LEFT JOIN lumbung.users cu ON cu.id = k.confirmed_by
        WHERE k.flo_id = $1 ORDER BY c.code COLLATE "C"`,
      [id],
    ),
    () => c.query(
      `SELECT id, kind, dow, to_char(start_local, 'HH24:MI') AS start_local, to_char(end_local, 'HH24:MI') AS end_local,
              starts_at, ends_at
         FROM lumbung.availability_windows WHERE flo_id = $1
        ORDER BY kind COLLATE "C", dow NULLS LAST, start_local NULLS LAST, starts_at NULLS LAST, id`,
      [id],
    ),
    () => c.query(
      `SELECT na.id, na.category_id, c.code AS category_code, na.score, na.basis, na.requested_qty, na.unit,
              na.intended_distribution_date, na.available_stock_qty, na.expected_deliveries_qty, na.existing_support,
              au.display_name AS assessor_name, na.assessed_at, na.expires_at, na.status,
              cu.display_name AS confirmed_by_name,
              CASE
                WHEN na.status = 'PROPOSED' THEN CASE WHEN na.expires_at > lumbung.tenant_now() THEN 'PENDING' ELSE 'EXPIRED' END
                WHEN na.expires_at <= lumbung.tenant_now() THEN 'EXPIRED'
                WHEN na.assessed_at < lumbung.tenant_now() - interval '30 days' THEN 'STALE'
                ELSE 'FRESH'
              END AS freshness
         FROM lumbung.need_assessments na
         JOIN lumbung.categories c ON c.tenant_id = na.tenant_id AND c.id = na.category_id
         LEFT JOIN lumbung.users au ON au.id = na.assessor_id
         LEFT JOIN lumbung.users cu ON cu.id = na.confirmed_by
        WHERE na.flo_id = $1 ORDER BY na.assessed_at DESC, na.seq DESC`,
      [id],
    ),
  ]);

  // Receipts: strict historical windows (received_at in (now − N days, now]); grouped
  // by category AND unit so incomparable units are never added together.
  const [history, recent, perf, resp, agreements, renewals] = await sequential([
    () => c.query(
      `WITH ${NOW_CTE},
       rec AS (
         SELECT rl.category_id, rl.unit,
                coalesce(sum(rl.accepted_qty) FILTER (WHERE rl.received_at > n.t - interval '7 days'), 0) AS qty_7d,
                coalesce(sum(rl.accepted_qty) FILTER (WHERE rl.received_at > n.t - interval '30 days'), 0) AS qty_30d,
                coalesce(sum(rl.rejected_qty) FILTER (WHERE rl.received_at > n.t - interval '30 days'), 0) AS rejected_30d,
                coalesce(sum(rl.accepted_qty) FILTER (WHERE rl.received_at > n.t - interval '30 days' AND d.route = 'DIRECT'), 0) AS direct_30d,
                coalesce(sum(rl.accepted_qty) FILTER (WHERE rl.received_at > n.t - interval '30 days' AND d.route = 'WAREHOUSE_OUTBOUND'), 0) AS warehouse_30d,
                count(DISTINCT rl.receipt_id) FILTER (WHERE rl.received_at > n.t - interval '30 days')::int AS receipts_30d,
                max(rl.received_at) FILTER (WHERE rl.accepted_qty > 0) AS last_received_at
           FROM lumbung.receipt_lines rl
           CROSS JOIN n
           JOIN lumbung.delivery_lines dl ON dl.tenant_id = rl.tenant_id AND dl.id = rl.delivery_line_id
           JOIN lumbung.deliveries d ON d.tenant_id = dl.tenant_id AND d.id = dl.delivery_id
          WHERE rl.flo_id = $1 AND rl.is_current AND rl.received_at <= n.t
          GROUP BY rl.category_id, rl.unit
       ),
       cats AS (
         SELECT category_id FROM lumbung.flo_category_prefs WHERE flo_id = $1 AND preference <> 'EXCLUDE'
         UNION SELECT category_id FROM lumbung.category_demands WHERE flo_id = $1
         UNION SELECT category_id FROM rec
       )
       SELECT c.id AS category_id, c.code AS category_code, c.name_id AS category_name_id, c.name_en AS category_name_en,
              c.comparable_unit, rec.unit, (rec.unit IS NULL OR rec.unit = c.comparable_unit) AS comparable,
              coalesce(rec.qty_7d, 0) AS qty_7d, coalesce(rec.qty_30d, 0) AS qty_30d,
              coalesce(rec.rejected_30d, 0) AS rejected_30d, coalesce(rec.direct_30d, 0) AS direct_30d,
              coalesce(rec.warehouse_30d, 0) AS warehouse_30d, coalesce(rec.receipts_30d, 0) AS receipts_30d,
              rec.last_received_at
         FROM cats
         JOIN lumbung.categories c ON c.id = cats.category_id
         LEFT JOIN rec ON rec.category_id = cats.category_id
        ORDER BY c.code COLLATE "C", rec.unit COLLATE "C" NULLS FIRST`,
      [id],
    ),
    () => c.query(
      `SELECT rl.id AS receipt_line_id, d.code AS delivery_code, d.route, c.code AS category_code, rl.unit,
              rl.accepted_qty, rl.rejected_qty, rl.discrepancy_reason, rl.received_at
         FROM lumbung.receipt_lines rl
         JOIN lumbung.delivery_lines dl ON dl.tenant_id = rl.tenant_id AND dl.id = rl.delivery_line_id
         JOIN lumbung.deliveries d ON d.tenant_id = dl.tenant_id AND d.id = dl.delivery_id
         JOIN lumbung.categories c ON c.tenant_id = rl.tenant_id AND c.id = rl.category_id
        WHERE rl.flo_id = $1 AND rl.is_current AND rl.received_at <= lumbung.tenant_now()
        ORDER BY rl.received_at DESC, rl.id
        LIMIT 20`,
      [id],
    ),
    () => c.query(
      `WITH ${NOW_CTE}, ${OBLIGATION_PERF_CTE}
       SELECT type,
              count(perf)::int AS n,
              coalesce(sum(perf), 0)::float8 AS sum,
              count(*) FILTER (WHERE perf = 1)::int AS on_time,
              count(*) FILTER (WHERE perf = 0.5)::int AS late,
              count(*) FILTER (WHERE perf = 0)::int AS missing,
              count(*) FILTER (WHERE perf IS NULL AND state IN ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CLARIFICATION'))::int AS pending_review,
              count(*) FILTER (WHERE perf IS NULL AND state = 'OPEN')::int AS open_not_due,
              count(*) FILTER (WHERE state = 'EXCUSED')::int AS excused,
              min(anchor_at) FILTER (WHERE perf IS NOT NULL) AS period_from,
              max(anchor_at) FILTER (WHERE perf IS NOT NULL) AS period_to
         FROM obl WHERE flo_id = $1 GROUP BY type`,
      [id],
    ),
    () => c.query(
      `SELECT count(*) FILTER (WHERE o.r_eligible AND o.r_exclusion IS NULL)::int AS eligible,
              count(*) FILTER (WHERE o.r_eligible AND o.r_exclusion IS NULL AND o.r_timely)::int AS timely,
              count(*) FILTER (WHERE o.r_exclusion IS NOT NULL)::int AS excluded,
              min(coalesce(o.sent_at, o.queued_at, o.created_at)) FILTER (WHERE o.r_eligible AND o.r_exclusion IS NULL) AS period_from,
              max(coalesce(o.sent_at, o.queued_at, o.created_at)) FILTER (WHERE o.r_eligible AND o.r_exclusion IS NULL) AS period_to
         FROM lumbung.offers o
        WHERE o.flo_id = $1 AND coalesce(o.sent_at, o.queued_at, o.created_at) <= lumbung.tenant_now()`,
      [id],
    ),
    () => c.query(
      `SELECT a.id, a.version, a.review_state, lumbung.agreement_status(a, lumbung.tenant_now()) AS status,
              lumbung.agreement_is_expiring_soon(a, lumbung.tenant_now()) AS expiring_soon,
              a.document_media_id, a.signed_date, a.valid_from_date, a.valid_through_date, a.valid_from,
              a.document_end_date, a.end_date_interpretation, a.interpretation_note,
              a.valid_until_exclusive, a.effective_until, a.superseded_from, a.superseded_at,
              uu.display_name AS uploaded_by_name, ru.display_name AS reviewer_name,
              a.reviewed_at, a.revoked_at, a.revoke_reason, a.supersedes_id, a.revision, a.created_at
         FROM lumbung.agreements a
         LEFT JOIN lumbung.users uu ON uu.id = a.uploaded_by
         LEFT JOIN lumbung.users ru ON ru.id = a.reviewer_id
        WHERE a.flo_id = $1
        ORDER BY a.version DESC, a.created_at DESC, a.id`,
      [id],
    ),
    () => c.query(
      `SELECT rt.id, rt.agreement_id, a.version AS agreement_version, rt.offset_days, rt.due_at, rt.status,
              rt.submitted_agreement_id, sa.version AS submitted_version
         FROM lumbung.renewal_tasks rt
         JOIN lumbung.agreements a ON a.tenant_id = rt.tenant_id AND a.id = rt.agreement_id
         LEFT JOIN lumbung.agreements sa ON sa.tenant_id = rt.tenant_id AND sa.id = rt.submitted_agreement_id
        WHERE a.flo_id = $1
        ORDER BY rt.due_at, rt.offset_days DESC, rt.id`,
      [id],
    ),
  ]);

  const agreementIds = agreements.rows.map((a) => a.id as string);
  const needIds = needs.rows.map((n) => n.id as string);
  const openTasks = await c.query(
    `SELECT id, kind, subject_type, subject_id, severity, state, due_at, payload
       FROM lumbung.tasks
      WHERE state IN ('OPEN', 'CLAIMED')
        AND (subject_id = $1 OR subject_id = ANY($2::uuid[]) OR payload->>'flo_id' = $1::text)
      ORDER BY due_at NULLS LAST, created_at, id`,
    [id, agreementIds],
  );

  let audit: AuditView[] | null = null;
  if (opts.includeAudit) {
    const ar = await c.query(
      `SELECT e.id, e.occurred_at, e.action, e.actor_kind, u.display_name AS actor_name, e.subject_type, e.subject_id,
              e.subject_revision, e.reason, e.payload, e.correlation_id
         FROM lumbung.audit_events e
         LEFT JOIN lumbung.users u ON u.id = e.actor_id
        WHERE e.subject_id = $1 OR e.subject_id = ANY($2::uuid[]) OR e.subject_id = ANY($3::uuid[])
           OR e.payload->>'flo_id' = $1::text
        ORDER BY e.occurred_at DESC, e.seq DESC
        LIMIT $4`,
      [id, agreementIds, needIds, opts.auditLimit ?? 100],
    );
    audit = ar.rows.map((r) => ({
      id: r.id,
      occurred_at: iso(r.occurred_at)!,
      action: r.action,
      actor_kind: r.actor_kind,
      actor_name: r.actor_name,
      subject_type: r.subject_type,
      subject_id: r.subject_id,
      subject_revision: r.subject_revision,
      reason: r.reason,
      payload: r.payload ?? {},
      correlation_id: r.correlation_id,
    }));
  }

  const perfByType = new Map(perf.rows.map((r) => [r.type as ObligationType, r]));
  const byType: ReportingTypeStats[] = OBLIGATION_TYPES.map((type) => {
    const r = perfByType.get(type);
    const n = r ? (r.n as number) : 0;
    const sum = r ? (r.sum as number) : 0;
    return {
      type,
      weight: REPORTING_WEIGHTS[type],
      n,
      sum,
      value: smoothed(sum, n),
      on_time: r?.on_time ?? 0,
      late: r?.late ?? 0,
      missing: r?.missing ?? 0,
      pending_review: r?.pending_review ?? 0,
      open_not_due: r?.open_not_due ?? 0,
      excused: r?.excused ?? 0,
      period_from: iso(r?.period_from ?? null),
      period_to: iso(r?.period_to ?? null),
    };
  });

  const respRow = resp.rows[0] ?? { eligible: 0, timely: 0, excluded: 0, period_from: null, period_to: null };
  const revealed = !!opts.revealContacts;

  return {
    now,
    timezone: summaryRes.timezone,
    summary,
    profile: {
      id: f.id,
      code: f.code,
      name: f.name,
      flo_type: f.flo_type,
      service_model: f.service_model,
      status: f.status,
      address: f.address,
      area: f.area,
      lat: f.lat,
      lng: f.lng,
      location_confidence: f.location_confidence,
      cooking_capable: f.cooking_capable,
      storage_capabilities: f.storage_capabilities ?? [],
      halal_required: f.halal_required,
      allergen_exclusions: f.allergen_exclusions ?? [],
      tenure: f.tenure,
      revision: f.revision,
      created_at: iso(f.created_at)!,
      updated_at: iso(f.updated_at)!,
    },
    clusters: clusters.rows,
    contacts: contacts.rows.map((r) => {
      const shown = revealed ? revealContact(r.address_ciphertext, f.tenant_id) : null;
      return {
        id: r.id,
        channel: r.channel,
        address_hint: r.address_hint,
        address: shown,
        decrypt_failed: revealed && shown === null,
        role: r.role,
        verification_state: r.verification_state,
        consent_state: r.consent_state,
        opted_out_at: iso(r.opted_out_at),
        contact_hours: r.contact_hours,
      };
    }),
    contacts_revealed: revealed,
    category_prefs: prefs.rows,
    schedules: schedules.rows.map((s) => ({
      ...s,
      service_dows: (s.service_dows ?? []).map(Number),
      verified_at: iso(s.verified_at),
    })),
    demands: demands.rows,
    capacities: capacities.rows.map((k) => ({ ...k, confirmed_at: iso(k.confirmed_at) })),
    availability: availability.rows.map((w) => ({ ...w, starts_at: iso(w.starts_at), ends_at: iso(w.ends_at) })),
    needs: needs.rows.map((n) => ({ ...n, assessed_at: iso(n.assessed_at)!, expires_at: iso(n.expires_at)! })),
    history: history.rows.map((h) => ({ ...h, last_received_at: iso(h.last_received_at) })),
    recent_receipts: recent.rows.map((r) => ({ ...r, received_at: iso(r.received_at)! })),
    responsiveness: {
      eligible: respRow.eligible,
      timely: respRow.timely,
      excluded: respRow.excluded,
      value: smoothed(respRow.timely, respRow.eligible),
      period_from: iso(respRow.period_from),
      period_to: iso(respRow.period_to),
    },
    reporting: {
      value: byType.reduce((acc, t) => acc + t.weight * t.value, 0),
      n: byType.reduce((acc, t) => acc + t.n, 0),
      by_type: byType,
    },
    agreements: agreements.rows.map((a) => ({
      ...a,
      valid_from: iso(a.valid_from)!,
      valid_until_exclusive: iso(a.valid_until_exclusive)!,
      effective_until: iso(a.effective_until)!,
      superseded_from: iso(a.superseded_from),
      superseded_at: iso(a.superseded_at),
      reviewed_at: iso(a.reviewed_at),
      revoked_at: iso(a.revoked_at),
      created_at: iso(a.created_at)!,
    })),
    renewal_tasks: renewals.rows.map((r) => ({ ...r, due_at: iso(r.due_at)! })),
    open_tasks: openTasks.rows.map((t) => ({ ...t, due_at: iso(t.due_at), payload: t.payload ?? {} })),
    audit,
  };
}

/** Agreement row (for the review page and command pre-checks). */
export async function getAgreementFloId(c: Queryable, agreementId: string): Promise<string | null> {
  if (!isUuid(agreementId)) return null;
  const r = await c.query<{ flo_id: string }>(`SELECT flo_id FROM lumbung.agreements WHERE id = $1`, [agreementId]);
  return r.rows[0]?.flo_id ?? null;
}
