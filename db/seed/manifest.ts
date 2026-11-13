/**
 * Seed manifest (architecture B step 6): counts computed by SQL over the seeded tenant,
 * plus seed, clock and schema_version (= max applied migration). Stored in
 * lumbung.seed_manifests and compared with the committed db/seed/expected-manifest.json.
 *
 * Counts are slug-independent (ids differ per tenant namespace, volumes do not), so any
 * tenant seeded with the canonical seed + clock must reproduce the expected counts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';

type Queryable = Pick<pg.PoolClient, 'query'>;

export interface SeedManifest {
  seed: number;
  clock: string;
  schema_version: number;
  counts: Record<string, unknown>;
}

export function defaultExpectedPath(): string {
  return path.join(process.cwd(), 'db', 'seed', 'expected-manifest.json');
}

/** B.3 classifier in SQL at instant $2 (used by the manifest and AC01 tests). */
export const AGREEMENT_CLASS_SQL = `
  SELECT f.id AS flo_id, f.code,
         CASE
           WHEN v.until IS NOT NULL AND v.until - $2::timestamptz > interval '30 days' THEN 'ACTIVE_GT30'
           WHEN v.until IS NOT NULL THEN 'EXPIRING'
           WHEN EXISTS (SELECT 1 FROM lumbung.agreements a
                         WHERE a.tenant_id = f.tenant_id AND a.flo_id = f.id AND a.review_state = 'APPROVED') THEN 'EXPIRED'
           ELSE 'PENDING'
         END AS agreement_class
    FROM lumbung.flos f
    LEFT JOIN LATERAL (
      SELECT a.valid_until_exclusive AS until
        FROM lumbung.agreements a
       WHERE a.tenant_id = f.tenant_id AND a.id = lumbung.agreement_valid_at_for(f.tenant_id, f.id, $2::timestamptz)
    ) v ON true
   WHERE f.tenant_id = $1`;

/** People band of the current documented schedule. */
export const PEOPLE_BAND_SQL = `
  SELECT f.id AS flo_id, f.code,
         CASE
           WHEN s.people_per_event BETWEEN 10 AND 30 THEN 'B10_30'
           WHEN s.people_per_event BETWEEN 31 AND 80 THEN 'B31_80'
           WHEN s.people_per_event BETWEEN 81 AND 200 THEN 'B81_200'
           WHEN s.people_per_event BETWEEN 201 AND 500 THEN 'B201_500'
           ELSE 'OTHER'
         END AS band
    FROM lumbung.flos f
    JOIN LATERAL (
      SELECT ss.people_per_event FROM lumbung.service_schedules ss
       WHERE ss.tenant_id = f.tenant_id AND ss.flo_id = f.id
       ORDER BY ss.effective_from DESC, ss.id LIMIT 1
    ) s ON true
   WHERE f.tenant_id = $1`;

const SCALAR_COUNTS: Record<string, string> = {
  flos: `SELECT count(*)::int FROM lumbung.flos WHERE tenant_id = $1`,
  flo_contacts: `SELECT count(*)::int FROM lumbung.flo_contacts WHERE tenant_id = $1`,
  memberships: `SELECT count(*)::int FROM lumbung.memberships WHERE tenant_id = $1`,
  volunteer_profiles: `SELECT count(*)::int FROM lumbung.volunteer_profiles WHERE tenant_id = $1`,
  volunteer_routes: `SELECT count(*)::int FROM lumbung.volunteer_routes WHERE tenant_id = $1`,
  donors: `SELECT count(*)::int FROM lumbung.donors WHERE tenant_id = $1`,
  donor_source_locations: `SELECT count(*)::int FROM lumbung.source_locations WHERE tenant_id = $1 AND kind = 'DONOR_SITE'`,
  warehouses: `SELECT count(*)::int FROM lumbung.source_locations WHERE tenant_id = $1 AND kind = 'WAREHOUSE'`,
  storage_locations: `SELECT count(*)::int FROM lumbung.storage_locations WHERE tenant_id = $1`,
  categories: `SELECT count(*)::int FROM lumbung.categories WHERE tenant_id = $1`,
  products: `SELECT count(*)::int FROM lumbung.products WHERE tenant_id = $1`,
  unit_conversions: `SELECT count(*)::int FROM lumbung.unit_conversions WHERE tenant_id = $1`,
  clusters: `SELECT count(*)::int FROM lumbung.clusters WHERE tenant_id = $1`,
  policy_versions: `SELECT count(*)::int FROM lumbung.policy_versions WHERE tenant_id = $1`,
  activation_decisions_not_decided: `SELECT count(*)::int FROM lumbung.activation_decisions WHERE tenant_id = $1 AND status = 'NOT_DECIDED'`,
  donation_orders: `SELECT count(*)::int FROM lumbung.donation_orders WHERE tenant_id = $1`,
  donation_orders_today: `SELECT count(*)::int FROM lumbung.donation_orders o JOIN lumbung.tenants t ON t.id = o.tenant_id
                           WHERE o.tenant_id = $1 AND (o.created_at AT TIME ZONE t.timezone)::date = ($2::timestamptz AT TIME ZONE t.timezone)::date`,
  donation_items: `SELECT count(*)::int FROM lumbung.donation_items WHERE tenant_id = $1`,
  allocations: `SELECT count(*)::int FROM lumbung.allocations WHERE tenant_id = $1`,
  allocations_with_accepted_receipt: `
    SELECT count(DISTINCT dl.allocation_id)::int FROM lumbung.receipt_lines rl
      JOIN lumbung.flo_receipts r ON r.tenant_id = rl.tenant_id AND r.id = rl.receipt_id AND r.status = 'CURRENT'
      JOIN lumbung.delivery_lines dl ON dl.tenant_id = rl.tenant_id AND dl.id = rl.delivery_line_id
     WHERE rl.tenant_id = $1 AND rl.is_current AND rl.accepted_qty > 0`,
  receipts_partial: `SELECT count(*)::int FROM lumbung.receipt_lines WHERE tenant_id = $1 AND is_current AND rejected_qty > 0`,
  offers: `SELECT count(*)::int FROM lumbung.offers WHERE tenant_id = $1`,
  offers_fee_unaffordable_timely: `SELECT count(*)::int FROM lumbung.offers WHERE tenant_id = $1 AND decline_reason_code = 'FEE_UNAFFORDABLE' AND r_timely IS NOT FALSE`,
  outreach_campaigns: `SELECT count(*)::int FROM lumbung.outreach_campaigns WHERE tenant_id = $1`,
  transport_arrangements: `SELECT count(*)::int FROM lumbung.transport_arrangements WHERE tenant_id = $1`,
  deliveries: `SELECT count(*)::int FROM lumbung.deliveries WHERE tenant_id = $1`,
  flo_receipts: `SELECT count(*)::int FROM lumbung.flo_receipts WHERE tenant_id = $1`,
  flo_receipts_imported: `SELECT count(*)::int FROM lumbung.flo_receipts WHERE tenant_id = $1 AND origin = 'IMPORT'`,
  distribution_events: `SELECT count(*)::int FROM lumbung.distribution_events WHERE tenant_id = $1`,
  receipts_with_distribution: `SELECT count(DISTINCT receipt_id)::int FROM lumbung.distribution_events WHERE tenant_id = $1`,
  evidence_submissions: `SELECT count(*)::int FROM lumbung.evidence_submissions WHERE tenant_id = $1`,
  evidence_submissions_resubmitted: `SELECT count(*)::int FROM lumbung.evidence_submissions WHERE tenant_id = $1 AND version > 1`,
  evidence_reviews: `SELECT count(*)::int FROM lumbung.evidence_reviews WHERE tenant_id = $1`,
  expected_inbounds: `SELECT count(*)::int FROM lumbung.expected_inbounds WHERE tenant_id = $1`,
  expected_inbounds_due_today: `SELECT count(*)::int FROM lumbung.expected_inbounds e JOIN lumbung.tenants t ON t.id = e.tenant_id
                                 WHERE e.tenant_id = $1 AND e.state = 'EXPECTED'
                                   AND (e.expected_at AT TIME ZONE t.timezone)::date = ($2::timestamptz AT TIME ZONE t.timezone)::date`,
  inspections: `SELECT count(*)::int FROM lumbung.inspections WHERE tenant_id = $1`,
  inspection_lines: `SELECT count(*)::int FROM lumbung.inspection_lines WHERE tenant_id = $1`,
  inspection_lines_quarantined: `SELECT count(*)::int FROM lumbung.inspection_lines WHERE tenant_id = $1 AND quarantined_qty > 0`,
  inspection_lines_rejected: `SELECT count(*)::int FROM lumbung.inspection_lines WHERE tenant_id = $1 AND rejected_qty > 0`,
  dispositions: `SELECT count(*)::int FROM lumbung.dispositions WHERE tenant_id = $1`,
  inventory_batches: `SELECT count(*)::int FROM lumbung.inventory_batches WHERE tenant_id = $1`,
  stock_movements: `SELECT count(*)::int FROM lumbung.stock_movements WHERE tenant_id = $1`,
  movement_entries: `SELECT count(*)::int FROM lumbung.movement_entries WHERE tenant_id = $1`,
  batch_balances: `SELECT count(*)::int FROM lumbung.batch_balances WHERE tenant_id = $1`,
  renewal_tasks: `SELECT count(*)::int FROM lumbung.renewal_tasks WHERE tenant_id = $1`,
  media_files: `SELECT count(*)::int FROM lumbung.media_files WHERE tenant_id = $1`,
  media_duplicates: `SELECT count(*)::int FROM lumbung.media_files WHERE tenant_id = $1 AND duplicate_of_media_id IS NOT NULL`,
  audit_events: `SELECT count(*)::int FROM lumbung.audit_events WHERE tenant_id = $1`,
  external_mappings: `SELECT count(*)::int FROM lumbung.external_mappings WHERE tenant_id = $1`,
  need_assessments: `SELECT count(*)::int FROM lumbung.need_assessments WHERE tenant_id = $1`,
  category_demands: `SELECT count(*)::int FROM lumbung.category_demands WHERE tenant_id = $1`,
  flo_category_capacities_unknown: `SELECT count(*)::int FROM lumbung.flo_category_capacities WHERE tenant_id = $1 AND per_event_capacity IS NULL`,
};

const GROUPED_COUNTS: Record<string, string> = {
  flos_by_area: `SELECT area AS k, count(*)::int AS n FROM lumbung.flos WHERE tenant_id = $1 GROUP BY 1`,
  flos_by_type: `SELECT flo_type AS k, count(*)::int AS n FROM lumbung.flos WHERE tenant_id = $1 GROUP BY 1`,
  flos_by_tenure: `SELECT tenure AS k, count(*)::int AS n FROM lumbung.flos WHERE tenant_id = $1 GROUP BY 1`,
  flos_by_location_confidence: `SELECT location_confidence AS k, count(*)::int AS n FROM lumbung.flos WHERE tenant_id = $1 GROUP BY 1`,
  flos_by_agreement_class: `SELECT agreement_class AS k, count(*)::int AS n FROM (${AGREEMENT_CLASS_SQL}) c GROUP BY 1`,
  flos_by_people_band: `SELECT band AS k, count(*)::int AS n FROM (${PEOPLE_BAND_SQL}) b GROUP BY 1`,
  agreements_by_review_state: `SELECT review_state AS k, count(*)::int AS n FROM lumbung.agreements WHERE tenant_id = $1 GROUP BY 1`,
  agreements_by_status_at_clock: `SELECT lumbung.agreement_status(a, $2::timestamptz) AS k, count(*)::int AS n FROM lumbung.agreements a WHERE a.tenant_id = $1 GROUP BY 1`,
  renewal_tasks_due_by_status: `SELECT status AS k, count(*)::int AS n FROM lumbung.renewal_tasks WHERE tenant_id = $1 AND due_at <= $2::timestamptz GROUP BY 1`,
  donation_orders_by_route: `SELECT route AS k, count(*)::int AS n FROM lumbung.donation_orders WHERE tenant_id = $1 GROUP BY 1`,
  donation_orders_by_state: `SELECT operational_state AS k, count(*)::int AS n FROM lumbung.donation_orders WHERE tenant_id = $1 GROUP BY 1`,
  allocations_by_state: `SELECT state AS k, count(*)::int AS n FROM lumbung.allocations WHERE tenant_id = $1 GROUP BY 1`,
  allocations_by_source_type: `SELECT source_type AS k, count(*)::int AS n FROM lumbung.allocations WHERE tenant_id = $1 GROUP BY 1`,
  allocations_cancel_reason: `SELECT cancel_reason AS k, count(*)::int AS n FROM lumbung.allocations WHERE tenant_id = $1 AND cancel_reason IS NOT NULL GROUP BY 1`,
  offers_by_state: `SELECT state AS k, count(*)::int AS n FROM lumbung.offers WHERE tenant_id = $1 GROUP BY 1`,
  offers_by_exclusion: `SELECT r_exclusion AS k, count(*)::int AS n FROM lumbung.offers WHERE tenant_id = $1 AND r_exclusion IS NOT NULL GROUP BY 1`,
  approvals_by_stage: `SELECT stage AS k, count(*)::int AS n FROM lumbung.approvals WHERE tenant_id = $1 GROUP BY 1`,
  reservations_by_state: `SELECT kind || ':' || state AS k, count(*)::int AS n FROM lumbung.reservations WHERE tenant_id = $1 GROUP BY 1`,
  transport_by_quote_status: `SELECT quote_status AS k, count(*)::int AS n FROM lumbung.transport_arrangements WHERE tenant_id = $1 GROUP BY 1`,
  deliveries_by_state: `SELECT state AS k, count(*)::int AS n FROM lumbung.deliveries WHERE tenant_id = $1 GROUP BY 1`,
  volunteer_profiles_by_vehicle: `SELECT vehicle_type AS k, count(*)::int AS n FROM lumbung.volunteer_profiles WHERE tenant_id = $1 GROUP BY 1`,
  volunteer_routes_by_state: `SELECT state AS k, count(*)::int AS n FROM lumbung.volunteer_routes WHERE tenant_id = $1 GROUP BY 1`,
  evidence_obligations_by_type: `SELECT type AS k, count(*)::int AS n FROM lumbung.evidence_obligations WHERE tenant_id = $1 GROUP BY 1`,
  evidence_obligations_by_state: `SELECT state AS k, count(*)::int AS n FROM lumbung.evidence_obligations WHERE tenant_id = $1 GROUP BY 1`,
  evidence_obligations_by_timeliness: `SELECT coalesce(resolved_timeliness, 'UNRESOLVED') AS k, count(*)::int AS n FROM lumbung.evidence_obligations WHERE tenant_id = $1 GROUP BY 1`,
  evidence_reviews_by_outcome: `SELECT outcome AS k, count(*)::int AS n FROM lumbung.evidence_reviews WHERE tenant_id = $1 GROUP BY 1`,
  expected_inbounds_by_state: `SELECT state AS k, count(*)::int AS n FROM lumbung.expected_inbounds WHERE tenant_id = $1 GROUP BY 1`,
  inspections_by_lot_count: `SELECT n_lots::text AS k, count(*)::int AS n FROM (
      SELECT i.id, count(il.id) AS n_lots FROM lumbung.inspections i
        JOIN lumbung.inspection_lines il ON il.tenant_id = i.tenant_id AND il.inspection_id = i.id
       WHERE i.tenant_id = $1 GROUP BY i.id) x GROUP BY 1`,
  batches_by_status: `SELECT status AS k, count(*)::int AS n FROM lumbung.v_batch_status WHERE tenant_id = $1 GROUP BY 1`,
  stock_movements_by_type: `SELECT type AS k, count(*)::int AS n FROM lumbung.stock_movements WHERE tenant_id = $1 GROUP BY 1`,
  tasks_by_kind: `SELECT kind AS k, count(*)::int AS n FROM lumbung.tasks WHERE tenant_id = $1 GROUP BY 1`,
  jobs_by_kind: `SELECT kind AS k, count(*)::int AS n FROM lumbung.jobs WHERE tenant_id = $1 GROUP BY 1`,
  renewal_tasks_by_status: `SELECT status AS k, count(*)::int AS n FROM lumbung.renewal_tasks WHERE tenant_id = $1 GROUP BY 1`,
  memberships_by_role: `SELECT role_label AS k, count(*)::int AS n FROM lumbung.memberships WHERE tenant_id = $1 GROUP BY 1`,
};

function sortedObject(entries: [string, number][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out[k] = v;
  return out;
}

export async function schemaVersion(c: Queryable): Promise<number> {
  const { rows } = await c.query<{ v: number | null }>(`SELECT max(version)::int AS v FROM lumbung.schema_migrations`);
  return rows[0].v ?? 0;
}

export async function computeCounts(c: Queryable, tenantId: string, clockIso: string): Promise<Record<string, unknown>> {
  const counts: Record<string, unknown> = {};
  for (const name of Object.keys(SCALAR_COUNTS).sort()) {
    const sql = SCALAR_COUNTS[name];
    const params = sql.includes('$2') ? [tenantId, clockIso] : [tenantId];
    const { rows } = await c.query(sql, params);
    counts[name] = Object.values(rows[0])[0];
  }
  for (const name of Object.keys(GROUPED_COUNTS).sort()) {
    const sql = GROUPED_COUNTS[name];
    const params = sql.includes('$2') ? [tenantId, clockIso] : [tenantId];
    const { rows } = await c.query<{ k: string; n: number }>(sql, params);
    counts[name] = sortedObject(rows.map((r) => [r.k, r.n]));
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

export function readExpected(file = defaultExpectedPath()): SeedManifest | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as SeedManifest;
}

export function writeExpected(m: SeedManifest, file = defaultExpectedPath()): void {
  writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

/** Differences between two count maps (deep, JSON-level), as readable paths. */
export function diffCounts(expected: Record<string, unknown>, actual: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of [...keys].sort()) {
    const e = expected[k];
    const a = actual[k];
    if (e && a && typeof e === 'object' && typeof a === 'object') {
      out.push(...diffCounts(e as Record<string, unknown>, a as Record<string, unknown>, `${prefix}${k}.`));
    } else if (JSON.stringify(e) !== JSON.stringify(a)) {
      out.push(`${prefix}${k}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
    }
  }
  return out;
}
