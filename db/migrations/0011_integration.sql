-- 0011_integration: external mappings, imports, seed manifests, the tenant
-- invariant checker and the protected demo reset.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.external_mappings (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  system       text NOT NULL,
  entity_type  text NOT NULL,
  external_id  text NOT NULL,
  internal_id  uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, system, entity_type, external_id)
);
CREATE INDEX external_mappings_internal_idx ON lumbung.external_mappings (tenant_id, internal_id);

CREATE TABLE lumbung.import_runs (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  file_sha256      text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  source_revision  text,
  state            text NOT NULL DEFAULT 'PREVIEWED' CHECK (state IN ('PREVIEWED','COMMITTED','FAILED')),
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE lumbung.import_rows (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  run_id        uuid NOT NULL,
  row_no        integer NOT NULL CHECK (row_no > 0),
  raw           jsonb NOT NULL,
  parsed        jsonb,
  errors        jsonb,
  duplicate_of  uuid,
  action        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, run_id, row_no),
  FOREIGN KEY (tenant_id, run_id) REFERENCES lumbung.import_runs(tenant_id, id)
);

CREATE TABLE lumbung.seed_manifests (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  seed            bigint NOT NULL,
  clock           timestamptz NOT NULL,
  schema_version  integer NOT NULL,
  counts          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  UNIQUE (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- verify_tenant_invariants(tenant): one row per violation; 0 rows = healthy.
-- Owner-only (explicit tenant parameter). The seed requires 0 rows.
-- Codes (stable; extend in later stages by CREATE OR REPLACE):
--   CLOCK_MISSING                    DEMO/TEST tenant without tenant_clocks row
--   AGREEMENT_INTERVAL_MISMATCH      instants != local legal dates in tenant tz
--   AGREEMENT_OVERLAP                two APPROVED intervals overlap for one FLO
--   HANDOVER_AGREEMENT_INVALID       current receipt not covered by an APPROVED
--                                    agreement (and no AGREEMENT_EXPIRED_AT_HANDOVER task)
--   DISPATCH_AGREEMENT_INVALID       dispatched delivery not covered at dispatched_at
--                                    (and no exception task)
--   RECEIPT_EXCEEDS_DISPATCHED       Σ current accepted+rejected > dispatched_qty
--   RECEIPT_OBLIGATION_MISSING       current receipt lacks BAST or RECEIPT_PHOTO obligation
--   FINAL_APPROVAL_MISSING           DISPATCHED+ allocation without FINAL_DISPATCH approval
--   OUTREACH_TRACE_MISSING           DISPATCHED+ allocation without OUTREACH approval on its
--                                    campaign or a MANUAL_ALLOCATION approval
--   DIRECT_ROUTE_STOCK               batch/movement/batch line tied to a DIRECT order or delivery
--   BALANCE_MISMATCH                 batch_balances != Σ movement_entries per (batch, account)
--   NEGATIVE_BALANCE                 physical account below zero
--   ITEM_OVERCOMMITTED               Σ ACTIVE/CONSUMED reservation lines > item quantity
--   NEW_FLO_HAS_HISTORY              tenure NEW FLO with receipts/offers before the seed clock
-- ---------------------------------------------------------------------------
CREATE TYPE lumbung.invariant_violation AS (
  code          text,
  subject_type  text,
  subject_id    uuid,
  detail        jsonb
);

CREATE FUNCTION lumbung.verify_tenant_invariants(p_tenant uuid)
  RETURNS SETOF lumbung.invariant_violation
  LANGUAGE sql STABLE
  SET search_path = lumbung, pg_temp
  AS $$
  WITH t AS (
    SELECT tn.id, tn.timezone, tn.mode FROM lumbung.tenants tn WHERE tn.id = p_tenant
  ),
  history_cutoff AS (
    SELECT coalesce(
      (SELECT sm.clock FROM lumbung.seed_manifests sm WHERE sm.tenant_id = p_tenant
        ORDER BY sm.created_at DESC, sm.id DESC LIMIT 1),
      lumbung.tenant_now_at(p_tenant)) AS at
  ),
  current_receipt_lines AS (
    SELECT rl.* FROM lumbung.receipt_lines rl
     JOIN lumbung.flo_receipts r ON r.tenant_id = rl.tenant_id AND r.id = rl.receipt_id
    WHERE rl.tenant_id = p_tenant AND rl.is_current AND r.status = 'CURRENT'
  ),
  ledger AS (
    SELECT e.batch_id, e.account, sum(e.signed_qty) AS qty
      FROM lumbung.movement_entries e
     WHERE e.tenant_id = p_tenant
     GROUP BY e.batch_id, e.account
  ),
  balances AS (
    SELECT bb.batch_id, bb.account, bb.qty FROM lumbung.batch_balances bb WHERE bb.tenant_id = p_tenant
  )
  -- CLOCK_MISSING
  SELECT 'CLOCK_MISSING', 'TENANT', t.id, jsonb_build_object('mode', t.mode)
    FROM t
   WHERE t.mode IN ('DEMO','TEST')
     AND NOT EXISTS (SELECT 1 FROM lumbung.tenant_clocks c WHERE c.tenant_id = t.id)

  UNION ALL
  -- AGREEMENT_INTERVAL_MISMATCH
  SELECT 'AGREEMENT_INTERVAL_MISMATCH', 'AGREEMENT', a.id,
         jsonb_build_object('valid_from', a.valid_from, 'valid_until_exclusive', a.valid_until_exclusive,
                            'valid_from_date', a.valid_from_date, 'valid_through_date', a.valid_through_date,
                            'timezone', t.timezone)
    FROM lumbung.agreements a CROSS JOIN t
   WHERE a.tenant_id = p_tenant
     AND (a.valid_from <> (a.valid_from_date::timestamp AT TIME ZONE t.timezone)
          OR a.valid_until_exclusive <> ((a.valid_through_date + 1)::timestamp AT TIME ZONE t.timezone))

  UNION ALL
  -- AGREEMENT_OVERLAP
  SELECT 'AGREEMENT_OVERLAP', 'AGREEMENT', a.id, jsonb_build_object('other_agreement_id', b.id, 'flo_id', a.flo_id)
    FROM lumbung.agreements a
    JOIN lumbung.agreements b
      ON b.tenant_id = a.tenant_id AND b.flo_id = a.flo_id AND b.id > a.id
     AND b.review_state = 'APPROVED'
     AND a.valid_from < b.valid_until_exclusive AND b.valid_from < a.valid_until_exclusive
   WHERE a.tenant_id = p_tenant AND a.review_state = 'APPROVED'

  UNION ALL
  -- HANDOVER_AGREEMENT_INVALID
  SELECT 'HANDOVER_AGREEMENT_INVALID', 'FLO_RECEIPT', r.id,
         jsonb_build_object('flo_id', r.flo_id, 'received_at', r.received_at, 'delivery_id', r.delivery_id)
    FROM lumbung.flo_receipts r
   WHERE r.tenant_id = p_tenant AND r.status = 'CURRENT'
     AND lumbung.agreement_valid_at_for(p_tenant, r.flo_id, r.received_at) IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM lumbung.tasks tk
        WHERE tk.tenant_id = p_tenant AND tk.kind = 'AGREEMENT_EXPIRED_AT_HANDOVER'
          AND tk.subject_id IN (r.id, r.delivery_id))

  UNION ALL
  -- DISPATCH_AGREEMENT_INVALID
  SELECT 'DISPATCH_AGREEMENT_INVALID', 'DELIVERY', d.id,
         jsonb_build_object('flo_id', d.destination_flo_id, 'dispatched_at', d.dispatched_at)
    FROM lumbung.deliveries d
   WHERE d.tenant_id = p_tenant AND d.dispatched_at IS NOT NULL
     AND lumbung.agreement_valid_at_for(p_tenant, d.destination_flo_id, d.dispatched_at) IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM lumbung.tasks tk
        WHERE tk.tenant_id = p_tenant
          AND tk.kind IN ('AGREEMENT_EXPIRED_AT_HANDOVER','AGREEMENT_EXPIRES_IN_TRANSIT','AGREEMENT_REVOKED_ACTIVE_COMMITMENT')
          AND tk.subject_id = d.id)

  UNION ALL
  -- RECEIPT_EXCEEDS_DISPATCHED
  SELECT 'RECEIPT_EXCEEDS_DISPATCHED', 'DELIVERY_LINE', dl.id,
         jsonb_build_object('dispatched_qty', dl.dispatched_qty,
                            'received_qty', sum(crl.accepted_qty + crl.rejected_qty))
    FROM lumbung.delivery_lines dl
    JOIN current_receipt_lines crl ON crl.delivery_line_id = dl.id
   WHERE dl.tenant_id = p_tenant
   GROUP BY dl.id, dl.dispatched_qty
  HAVING dl.dispatched_qty IS NULL OR sum(crl.accepted_qty + crl.rejected_qty) > dl.dispatched_qty

  UNION ALL
  -- RECEIPT_OBLIGATION_MISSING
  SELECT 'RECEIPT_OBLIGATION_MISSING', 'FLO_RECEIPT', r.id,
         jsonb_build_object('delivery_id', r.delivery_id, 'missing_type', ty.type)
    FROM lumbung.flo_receipts r
   CROSS JOIN (VALUES ('BAST'), ('RECEIPT_PHOTO')) AS ty(type)
   WHERE r.tenant_id = p_tenant AND r.status = 'CURRENT'
     AND NOT EXISTS (
       SELECT 1 FROM lumbung.evidence_obligations o
        WHERE o.tenant_id = p_tenant AND o.type = ty.type
          AND o.subject_type = 'DELIVERY' AND o.subject_id = r.delivery_id)

  UNION ALL
  -- FINAL_APPROVAL_MISSING
  SELECT 'FINAL_APPROVAL_MISSING', 'ALLOCATION', al.id, jsonb_build_object('state', al.state)
    FROM lumbung.allocations al
   WHERE al.tenant_id = p_tenant
     AND al.state IN ('DISPATCHED','PARTIALLY_RECEIVED','RECEIVED')
     AND NOT EXISTS (
       SELECT 1 FROM lumbung.approvals ap
        WHERE ap.tenant_id = p_tenant AND ap.stage = 'FINAL_DISPATCH'
          AND ap.subject_id = al.id AND ap.invalidated_at IS NULL)

  UNION ALL
  -- OUTREACH_TRACE_MISSING
  SELECT 'OUTREACH_TRACE_MISSING', 'ALLOCATION', al.id,
         jsonb_build_object('state', al.state, 'campaign_id', al.campaign_id, 'manual_approval_id', al.manual_approval_id)
    FROM lumbung.allocations al
   WHERE al.tenant_id = p_tenant
     AND al.state IN ('DISPATCHED','PARTIALLY_RECEIVED','RECEIVED')
     AND NOT EXISTS (
       SELECT 1 FROM lumbung.approvals ap
        WHERE ap.tenant_id = p_tenant AND ap.stage = 'OUTREACH' AND ap.subject_id = al.campaign_id)
     AND NOT EXISTS (
       SELECT 1 FROM lumbung.approvals ap
        WHERE ap.tenant_id = p_tenant AND ap.stage = 'MANUAL_ALLOCATION' AND ap.id = al.manual_approval_id)

  UNION ALL
  -- DIRECT_ROUTE_STOCK: batches from DIRECT orders
  SELECT 'DIRECT_ROUTE_STOCK', 'BATCH', b.id, jsonb_build_object('donor_order_id', b.donor_order_id)
    FROM lumbung.inventory_batches b
    JOIN lumbung.donation_orders o ON o.tenant_id = b.tenant_id AND o.id = b.donor_order_id
   WHERE b.tenant_id = p_tenant AND o.route = 'DIRECT'

  UNION ALL
  -- DIRECT_ROUTE_STOCK: stock lines on DIRECT deliveries
  SELECT 'DIRECT_ROUTE_STOCK', 'DELIVERY_LINE', dl.id, jsonb_build_object('batch_id', dl.batch_id)
    FROM lumbung.delivery_lines dl
    JOIN lumbung.deliveries d ON d.tenant_id = dl.tenant_id AND d.id = dl.delivery_id
   WHERE dl.tenant_id = p_tenant AND d.route = 'DIRECT' AND dl.batch_id IS NOT NULL

  UNION ALL
  -- DIRECT_ROUTE_STOCK: batch reservations for direct allocations
  SELECT 'DIRECT_ROUTE_STOCK', 'RESERVATION_LINE', rl.id, jsonb_build_object('batch_id', rl.batch_id)
    FROM lumbung.reservation_lines rl
    JOIN lumbung.reservations rs ON rs.tenant_id = rl.tenant_id AND rs.id = rl.reservation_id
   WHERE rl.tenant_id = p_tenant AND rs.source_type = 'DIRECT_ITEM' AND rl.batch_id IS NOT NULL

  UNION ALL
  -- BALANCE_MISMATCH
  SELECT 'BALANCE_MISMATCH', 'BATCH', coalesce(bal.batch_id, l.batch_id),
         jsonb_build_object('account', coalesce(bal.account, l.account),
                            'balance', coalesce(bal.qty, 0), 'ledger', coalesce(l.qty, 0))
    FROM balances bal
    FULL JOIN ledger l ON l.batch_id = bal.batch_id AND l.account = bal.account
   WHERE coalesce(bal.qty, 0) <> coalesce(l.qty, 0)

  UNION ALL
  -- NEGATIVE_BALANCE
  SELECT 'NEGATIVE_BALANCE', 'BATCH', bal.batch_id, jsonb_build_object('account', bal.account, 'qty', bal.qty)
    FROM balances bal
   WHERE bal.account NOT IN ('EXTERNAL_RECEIPT','ADJUSTMENT_OFFSET') AND bal.qty < 0

  UNION ALL
  -- ITEM_OVERCOMMITTED (direct route, INV04)
  SELECT 'ITEM_OVERCOMMITTED', 'DONATION_ITEM', di.id,
         jsonb_build_object('quantity', di.quantity, 'committed', sum(rl.quantity))
    FROM lumbung.donation_items di
    JOIN lumbung.reservation_lines rl
      ON rl.tenant_id = di.tenant_id AND rl.item_id = di.id AND rl.state IN ('ACTIVE','CONSUMED')
   WHERE di.tenant_id = p_tenant
   GROUP BY di.id, di.quantity
  HAVING di.quantity IS NULL OR sum(rl.quantity) > di.quantity

  UNION ALL
  -- NEW_FLO_HAS_HISTORY
  SELECT 'NEW_FLO_HAS_HISTORY', 'FLO', f.id, jsonb_build_object('code', f.code)
    FROM lumbung.flos f CROSS JOIN history_cutoff hc
   WHERE f.tenant_id = p_tenant AND f.tenure = 'NEW'
     AND (EXISTS (SELECT 1 FROM lumbung.flo_receipts r
                   WHERE r.tenant_id = p_tenant AND r.flo_id = f.id AND r.received_at < hc.at)
          OR EXISTS (SELECT 1 FROM lumbung.offers o
                      WHERE o.tenant_id = p_tenant AND o.flo_id = f.id
                        AND coalesce(o.sent_at, o.queued_at, o.created_at) < hc.at))
  $$;

-- ---------------------------------------------------------------------------
-- demo_reset_begin(slug): owner-only. Deletes a DEMO/TEST tenant and (by
-- ON DELETE CASCADE) everything it owns, including append-only rows, using
-- the transaction-local escape hatch. LIVE or non-demo tenants are refused.
-- Returns the deleted tenant id, or NULL when no such tenant exists.
-- The caller re-seeds in the same transaction.
-- ---------------------------------------------------------------------------
CREATE FUNCTION lumbung.demo_reset_begin(p_slug text) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_id     uuid;
    v_mode   text;
    v_demo   boolean;
  BEGIN
    SELECT t.id, t.mode, t.is_demo INTO v_id, v_mode, v_demo
      FROM lumbung.tenants t WHERE t.slug = p_slug FOR UPDATE;
    IF v_id IS NULL THEN
      RETURN NULL;
    END IF;
    IF v_mode NOT IN ('DEMO','TEST') OR NOT v_demo THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:RESET_FORBIDDEN',
        DETAIL = json_build_object('slug', p_slug, 'mode', v_mode, 'is_demo', v_demo)::text;
    END IF;
    PERFORM set_config('lumbung.reset_tenant', v_id::text, true);
    DELETE FROM lumbung.tenants WHERE id = v_id;
    PERFORM set_config('lumbung.reset_tenant', '', true);
    RETURN v_id;
  END
  $$;
