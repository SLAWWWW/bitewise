/**
 * Approval input hashes after the bulk insert (architecture B step 6).
 *
 * The single hash implementation lives in SQL. Stage 2 adds
 * lumbung.allocation_input_hash(uuid) / lumbung.campaign_plan_hash(uuid); when they
 * exist the seed uses them. Until then (Stage 1 schema) the seed computes the same
 * documented A.2 shape inline with lumbung.canonical_hash(jsonb) — still SQL, still
 * one canonical JSON (jsonb text) — and reports that it used the fallback.
 */
import type pg from 'pg';

type Queryable = Pick<pg.PoolClient, 'query'>;

export interface HashReport {
  campaignPlanHash: 'FUNCTION' | 'FALLBACK_SQL';
  allocationInputHash: 'FUNCTION' | 'FALLBACK_SQL';
  campaigns: number;
  finalApprovals: number;
  outreachApprovals: number;
}

async function hasFunction(c: Queryable, signature: string): Promise<boolean> {
  const { rows } = await c.query<{ ok: boolean }>(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [signature]);
  return rows[0].ok;
}

const FALLBACK_PLAN_HASH = `
  lumbung.canonical_hash(jsonb_build_object(
    'campaign_id', c.id,
    'revision', c.revision,
    'source', jsonb_build_object(
      'type', c.source_type,
      'item_id', c.item_id,
      'item_revision', di.revision,
      'batch_ids', (SELECT coalesce(jsonb_agg(DISTINCT rl.batch_id), '[]'::jsonb)
                      FROM lumbung.allocations al
                      JOIN lumbung.reservations r ON r.tenant_id = al.tenant_id AND r.allocation_id = al.id
                      JOIN lumbung.reservation_lines rl ON rl.tenant_id = r.tenant_id AND rl.reservation_id = r.id
                     WHERE al.tenant_id = c.tenant_id AND al.campaign_id = c.id AND rl.batch_id IS NOT NULL)),
    'product_id', coalesce(di.product_id, (SELECT b.product_id FROM lumbung.allocations al
                      JOIN lumbung.reservations r ON r.tenant_id = al.tenant_id AND r.allocation_id = al.id
                      JOIN lumbung.reservation_lines rl ON rl.tenant_id = r.tenant_id AND rl.reservation_id = r.id
                      JOIN lumbung.inventory_batches b ON b.tenant_id = rl.tenant_id AND b.id = rl.batch_id
                     WHERE al.tenant_id = c.tenant_id AND al.campaign_id = c.id ORDER BY b.id LIMIT 1)),
    'response_window_min', c.response_window_min,
    'expansion_bands', to_jsonb(c.expansion_bands),
    'template_version', c.template_version,
    'safety', (SELECT jsonb_build_object('policy_version_id', se.policy_version_id, 'verdict', se.verdict, 'usable_until', se.usable_until)
                 FROM lumbung.safety_evaluations se
                WHERE se.tenant_id = c.tenant_id AND se.subject_type = 'ITEM' AND se.subject_id = c.item_id
                ORDER BY se.created_at DESC, se.id DESC LIMIT 1),
    'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'flo_id', cl.flo_id, 'wave_no', cl.wave_no, 'max_qty', cl.max_qty, 'unit', cl.unit,
                       'receiving_start', cl.receiving_start, 'receiving_end', cl.receiving_end,
                       'distribution_deadline', cl.distribution_deadline)
                     ORDER BY f.code COLLATE "C"), '[]'::jsonb)
                FROM lumbung.campaign_lines cl
                JOIN lumbung.flos f ON f.tenant_id = cl.tenant_id AND f.id = cl.flo_id
               WHERE cl.tenant_id = c.tenant_id AND cl.campaign_id = c.id AND cl.campaign_revision = c.revision)))`;

const FALLBACK_INPUT_HASH = `
  lumbung.canonical_hash(jsonb_build_object(
    'allocation_id', al.id,
    'flo_id', al.flo_id,
    'agreement_id', ag.id,
    'agreement_revision', ag.revision,
    'item_id', al.item_id,
    'item_revision', di.revision,
    'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('batch_id', rl.batch_id, 'qty', rl.quantity) ORDER BY rl.batch_id), '[]'::jsonb)
                FROM lumbung.reservations r
                JOIN lumbung.reservation_lines rl ON rl.tenant_id = r.tenant_id AND rl.reservation_id = r.id
               WHERE r.tenant_id = al.tenant_id AND r.allocation_id = al.id AND rl.batch_id IS NOT NULL),
    'product_id', coalesce(di.product_id, (SELECT b.product_id FROM lumbung.reservations r
                JOIN lumbung.reservation_lines rl ON rl.tenant_id = r.tenant_id AND rl.reservation_id = r.id
                JOIN lumbung.inventory_batches b ON b.tenant_id = rl.tenant_id AND b.id = rl.batch_id
               WHERE r.tenant_id = al.tenant_id AND r.allocation_id = al.id ORDER BY b.id LIMIT 1)),
    'quantity', al.quantity,
    'unit', al.unit,
    'planned_pickup_start', al.planned_pickup_start,
    'planned_pickup_end', al.planned_pickup_end,
    'planned_receipt_at', al.planned_receipt_at,
    'planned_distribution_at', al.planned_distribution_at,
    'transport', CASE WHEN ta.id IS NULL THEN NULL ELSE jsonb_build_object(
                   'method', ta.method, 'payer', ta.payer, 'quote_status', ta.quote_status,
                   'confirmed_fee_idr', ta.confirmed_fee_idr, 'fee_accepted', ta.fee_accepted_at IS NOT NULL) END,
    'safety', (SELECT jsonb_build_object('policy_version_id', se.policy_version_id, 'verdict', se.verdict)
                 FROM lumbung.safety_evaluations se
                WHERE se.tenant_id = al.tenant_id AND se.subject_type = 'ITEM' AND se.subject_id = al.item_id
                ORDER BY se.created_at DESC, se.id DESC LIMIT 1)))`;

export async function recomputeApprovalHashes(c: Queryable, tenantId: string): Promise<HashReport> {
  const planFn = await hasFunction(c, 'lumbung.campaign_plan_hash(uuid)');
  const inputFn = await hasFunction(c, 'lumbung.allocation_input_hash(uuid)');

  const campaigns = planFn
    ? await c.query(`UPDATE lumbung.outreach_campaigns c SET plan_hash = lumbung.campaign_plan_hash(c.id) WHERE c.tenant_id = $1`, [tenantId])
    : await c.query(
        `UPDATE lumbung.outreach_campaigns c SET plan_hash = ${FALLBACK_PLAN_HASH}
           FROM lumbung.outreach_campaigns c0
           LEFT JOIN lumbung.donation_items di ON di.tenant_id = c0.tenant_id AND di.id = c0.item_id
          WHERE c.tenant_id = $1 AND c0.tenant_id = c.tenant_id AND c0.id = c.id`,
        [tenantId],
      );
  const outreach = await c.query(
    `UPDATE lumbung.approvals ap SET input_hash = c.plan_hash
       FROM lumbung.outreach_campaigns c
      WHERE ap.tenant_id = $1 AND ap.stage = 'OUTREACH' AND c.tenant_id = ap.tenant_id AND c.id = ap.subject_id`,
    [tenantId],
  );
  const finals = inputFn
    ? await c.query(
        `UPDATE lumbung.approvals ap SET input_hash = lumbung.allocation_input_hash(ap.subject_id)
          WHERE ap.tenant_id = $1 AND ap.stage = 'FINAL_DISPATCH'`,
        [tenantId],
      )
    : await c.query(
        `UPDATE lumbung.approvals ap SET input_hash = ${FALLBACK_INPUT_HASH}
           FROM lumbung.allocations al
           LEFT JOIN lumbung.donation_items di ON di.tenant_id = al.tenant_id AND di.id = al.item_id
           LEFT JOIN lumbung.transport_arrangements ta ON ta.tenant_id = al.tenant_id AND ta.allocation_id = al.id
           LEFT JOIN lumbung.agreements ag
             ON ag.tenant_id = al.tenant_id AND ag.id = lumbung.agreement_valid_at_for(al.tenant_id, al.flo_id, al.planned_receipt_at)
          WHERE ap.tenant_id = $1 AND ap.stage = 'FINAL_DISPATCH' AND al.tenant_id = ap.tenant_id AND al.id = ap.subject_id`,
        [tenantId],
      );
  return {
    campaignPlanHash: planFn ? 'FUNCTION' : 'FALLBACK_SQL',
    allocationInputHash: inputFn ? 'FUNCTION' : 'FALLBACK_SQL',
    campaigns: campaigns.rowCount ?? 0,
    finalApprovals: finals.rowCount ?? 0,
    outreachApprovals: outreach.rowCount ?? 0,
  };
}
