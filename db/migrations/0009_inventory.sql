-- 0009_inventory: expected inbounds, inspections, dispositions, batches,
-- double-entry stock ledger (movements + entries + balances), adjustments,
-- release plans, picking, recalls, derived batch status view.
--
-- Ledger rules: every movement's entries sum to zero per (movement, batch)
-- (deferred constraint trigger, checked at commit). batch_balances is
-- maintained only by post_stock_movement (S4) and is reconciled against
-- Σ entries by verify_tenant_invariants / a job. Ledger rows are append-only
-- (corrections are REVERSAL movements).

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.expected_inbounds (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL,
  warehouse_id  uuid NOT NULL,
  expected_at   timestamptz NOT NULL,
  state         text NOT NULL DEFAULT 'EXPECTED' CHECK (state IN ('EXPECTED','ARRIVED','INSPECTED','CLOSED','CANCELLED')),
  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES lumbung.donation_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES lumbung.source_locations(tenant_id, id)
);
CREATE INDEX expected_inbounds_state_idx ON lumbung.expected_inbounds (tenant_id, state, expected_at);

CREATE TABLE lumbung.inbound_lines (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  inbound_id    uuid NOT NULL,
  item_id       uuid,
  product_id    uuid NOT NULL,
  expected_qty  numeric(14,3) NOT NULL CHECK (expected_qty > 0),
  unit          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, inbound_id) REFERENCES lumbung.expected_inbounds(tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES lumbung.donation_items(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES lumbung.products(tenant_id, id)
);

CREATE TABLE lumbung.inspections (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  inbound_id     uuid NOT NULL,
  inspector_id   uuid NOT NULL REFERENCES lumbung.users(id),
  inspected_at   timestamptz NOT NULL,
  observations   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, inbound_id) REFERENCES lumbung.expected_inbounds(tenant_id, id)
);

CREATE TABLE lumbung.inspection_lines (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  inspection_id    uuid NOT NULL,
  inbound_line_id  uuid NOT NULL,
  external_lot     text,
  label_expiry     timestamptz,
  actual_qty       numeric(14,3) NOT NULL CHECK (actual_qty >= 0),
  accepted_qty     numeric(14,3) NOT NULL DEFAULT 0 CHECK (accepted_qty >= 0),
  quarantined_qty  numeric(14,3) NOT NULL DEFAULT 0 CHECK (quarantined_qty >= 0),
  rejected_qty     numeric(14,3) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  condition        text,
  storage_obs      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES lumbung.inspections(tenant_id, id),
  FOREIGN KEY (tenant_id, inbound_line_id) REFERENCES lumbung.inbound_lines(tenant_id, id),
  -- AC21
  CHECK (accepted_qty + quarantined_qty + rejected_qty = actual_qty)
);

CREATE TABLE lumbung.dispositions (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  source_type  text NOT NULL,
  source_id    uuid NOT NULL,
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  unit         text NOT NULL,
  kind         text NOT NULL,
  decided_by   uuid REFERENCES lumbung.users(id),
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  UNIQUE (tenant_id, id)
);
CREATE INDEX dispositions_source_idx ON lumbung.dispositions (tenant_id, source_id);

-- Batch status is DERIVED (v_batch_status), never stored.
CREATE TABLE lumbung.inventory_batches (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  batch_code           text NOT NULL,
  product_id           uuid NOT NULL,
  category_id          uuid NOT NULL,
  donor_order_id       uuid,
  donor_line_id        uuid,
  external_lot         text,
  base_unit            text NOT NULL,
  unit_kind            text NOT NULL CHECK (unit_kind IN ('COUNT','MASS','VOLUME')),
  storage_location_id  uuid,
  received_at          timestamptz NOT NULL,
  expires_at           timestamptz,
  handling_deadline    timestamptz,
  condition            text,
  inspection_id        uuid,
  restriction          text NOT NULL DEFAULT 'NONE' CHECK (restriction IN ('NONE','QUARANTINED','RECALL_HOLD')),
  conversion_id        uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, batch_code),
  FOREIGN KEY (tenant_id, product_id) REFERENCES lumbung.products(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id),
  FOREIGN KEY (tenant_id, donor_order_id) REFERENCES lumbung.donation_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, donor_line_id) REFERENCES lumbung.donation_items(tenant_id, id),
  FOREIGN KEY (tenant_id, storage_location_id) REFERENCES lumbung.storage_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, inspection_id) REFERENCES lumbung.inspections(tenant_id, id),
  FOREIGN KEY (tenant_id, conversion_id) REFERENCES lumbung.unit_conversions(tenant_id, id)
);
CREATE INDEX inventory_batches_fefo_idx
  ON lumbung.inventory_batches (tenant_id, product_id, restriction, (coalesce(expires_at, handling_deadline)), received_at, id);

CREATE TABLE lumbung.stock_movements (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  command_id      text NOT NULL,
  type            text NOT NULL CHECK (type IN ('RECEIPT','RESERVATION_TRANSFER','RESERVATION_RELEASE','DISPATCH_TRANSFER',
                    'DELIVERY_RECEIPT','VERIFIED_RETURN','ADJUSTMENT','DISPOSAL','QUARANTINE_RELEASE','REVERSAL')),
  reversal_of     uuid UNIQUE,
  reason          text,
  actor_id        uuid,
  occurred_at     timestamptz NOT NULL,
  correlation_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of) REFERENCES lumbung.stock_movements(tenant_id, id),
  CHECK ((type = 'REVERSAL') = (reversal_of IS NOT NULL))
);
CREATE INDEX stock_movements_command_idx ON lumbung.stock_movements (tenant_id, command_id);
CREATE INDEX stock_movements_occurred_idx ON lumbung.stock_movements (tenant_id, occurred_at, id);

CREATE TABLE lumbung.movement_entries (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  movement_id  uuid NOT NULL,
  batch_id     uuid NOT NULL,
  account      text NOT NULL CHECK (account IN ('AVAILABLE','RESERVED','IN_TRANSIT','QUARANTINE','RETURN_PENDING',
                 'DISPOSED','EXTERNAL_RECEIPT','DELIVERED','EXCEPTION','ADJUSTMENT_OFFSET')),
  signed_qty   numeric(14,3) NOT NULL CHECK (signed_qty <> 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, movement_id) REFERENCES lumbung.stock_movements(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES lumbung.inventory_batches(tenant_id, id)
);
CREATE INDEX movement_entries_movement_idx ON lumbung.movement_entries (tenant_id, movement_id, batch_id);
CREATE INDEX movement_entries_batch_idx ON lumbung.movement_entries (tenant_id, batch_id, account);

-- Zero-sum per (movement, batch), checked at commit.
CREATE FUNCTION lumbung.tg_movement_entries_balanced() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_sum numeric;
  BEGIN
    SELECT coalesce(sum(e.signed_qty), 0) INTO v_sum
      FROM lumbung.movement_entries e
     WHERE e.tenant_id = NEW.tenant_id AND e.movement_id = NEW.movement_id AND e.batch_id = NEW.batch_id;
    IF v_sum <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:LEDGER_UNBALANCED',
        DETAIL = json_build_object('movement_id', NEW.movement_id, 'batch_id', NEW.batch_id, 'sum', v_sum)::text;
    END IF;
    RETURN NULL;
  END
  $$;
CREATE CONSTRAINT TRIGGER movement_entries_balanced
  AFTER INSERT ON lumbung.movement_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION lumbung.tg_movement_entries_balanced();

CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON lumbung.stock_movements
  FOR EACH ROW EXECUTE FUNCTION lumbung.tg_append_only();
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON lumbung.stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION lumbung.tg_append_only();
CREATE TRIGGER movement_entries_append_only BEFORE UPDATE OR DELETE ON lumbung.movement_entries
  FOR EACH ROW EXECUTE FUNCTION lumbung.tg_append_only();
CREATE TRIGGER movement_entries_no_truncate BEFORE TRUNCATE ON lumbung.movement_entries
  FOR EACH STATEMENT EXECUTE FUNCTION lumbung.tg_append_only();

CREATE TABLE lumbung.batch_balances (
  tenant_id   uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  batch_id    uuid NOT NULL,
  account     text NOT NULL CHECK (account IN ('AVAILABLE','RESERVED','IN_TRANSIT','QUARANTINE','RETURN_PENDING',
                'DISPOSED','EXTERNAL_RECEIPT','DELIVERED','EXCEPTION','ADJUSTMENT_OFFSET')),
  qty         numeric(14,3) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, account),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES lumbung.inventory_batches(tenant_id, id),
  -- INV04: no physical account goes negative.
  CHECK (account IN ('EXTERNAL_RECEIPT','ADJUSTMENT_OFFSET') OR qty >= 0)
);
CREATE INDEX batch_balances_tenant_idx ON lumbung.batch_balances (tenant_id, batch_id);

CREATE TABLE lumbung.stock_adjustment_requests (
  id                       uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  batch_id                 uuid NOT NULL,
  requested_delta          numeric(14,3) NOT NULL CHECK (requested_delta <> 0),
  count_evidence_media_id  uuid NOT NULL,
  requester_id             uuid NOT NULL REFERENCES lumbung.users(id),
  approver_id              uuid REFERENCES lumbung.users(id),
  reason                   text NOT NULL,
  state                    text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','APPROVED','REJECTED')),
  decided_at               timestamptz,
  revision                 integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES lumbung.inventory_batches(tenant_id, id),
  FOREIGN KEY (tenant_id, count_evidence_media_id) REFERENCES lumbung.media_files(tenant_id, id),
  CHECK (approver_id IS NULL OR approver_id <> requester_id),
  CHECK (state = 'REQUESTED' OR approver_id IS NOT NULL)
);

-- Proactive warehouse release (S4 defines the state machine).
CREATE TABLE lumbung.release_plans (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  warehouse_id  uuid NOT NULL,
  state         text NOT NULL DEFAULT 'DRAFT',
  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES lumbung.source_locations(tenant_id, id)
);

CREATE TABLE lumbung.pick_lists (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  delivery_id  uuid NOT NULL,
  state        text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','PICKED','CANCELLED')),
  picker_id    uuid REFERENCES lumbung.users(id),
  picked_at    timestamptz,
  revision     integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, delivery_id) REFERENCES lumbung.deliveries(tenant_id, id)
);

CREATE TABLE lumbung.pick_lines (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  pick_list_id         uuid NOT NULL,
  reservation_line_id  uuid NOT NULL,
  batch_id             uuid NOT NULL,
  planned_qty          numeric(14,3) NOT NULL CHECK (planned_qty > 0),
  picked_qty           numeric(14,3) CHECK (picked_qty >= 0),
  substitution_note    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, pick_list_id) REFERENCES lumbung.pick_lists(tenant_id, id),
  FOREIGN KEY (tenant_id, reservation_line_id) REFERENCES lumbung.reservation_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES lumbung.inventory_batches(tenant_id, id)
);

CREATE TABLE lumbung.recalls (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  product_id  uuid,
  batch_id    uuid,
  reason      text NOT NULL,
  state       text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','CLOSED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES lumbung.products(tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES lumbung.inventory_batches(tenant_id, id),
  CHECK (num_nonnulls(product_id, batch_id) >= 1)
);

-- Deferred inventory FKs from earlier migrations.
ALTER TABLE lumbung.reservation_lines
  ADD FOREIGN KEY (tenant_id, batch_id) REFERENCES lumbung.inventory_batches(tenant_id, id);
ALTER TABLE lumbung.delivery_lines
  ADD FOREIGN KEY (tenant_id, batch_id) REFERENCES lumbung.inventory_batches(tenant_id, id);
ALTER TABLE lumbung.allocations
  ADD FOREIGN KEY (tenant_id, release_plan_id) REFERENCES lumbung.release_plans(tenant_id, id);
ALTER TABLE lumbung.outreach_campaigns
  ADD FOREIGN KEY (tenant_id, release_plan_id) REFERENCES lumbung.release_plans(tenant_id, id);

-- Derived batch status (PRD §12). security_invoker so the caller's RLS
-- applies. Precedence: RECALL_HOLD > QUARANTINED > DEPLETED > EXPIRED >
-- FULLY_RESERVED > PARTIALLY_RESERVED > AVAILABLE. Expiry uses the tenant
-- clock; a batch is expired at/after coalesce(expires_at, handling_deadline).
CREATE VIEW lumbung.v_batch_status WITH (security_invoker = true) AS
  WITH bal AS (
    SELECT bb.tenant_id, bb.batch_id,
           sum(bb.qty) FILTER (WHERE bb.account = 'AVAILABLE')      AS available_qty,
           sum(bb.qty) FILTER (WHERE bb.account = 'RESERVED')       AS reserved_qty,
           sum(bb.qty) FILTER (WHERE bb.account = 'QUARANTINE')     AS quarantine_qty,
           sum(bb.qty) FILTER (WHERE bb.account = 'IN_TRANSIT')     AS in_transit_qty,
           sum(bb.qty) FILTER (WHERE bb.account = 'RETURN_PENDING') AS return_pending_qty
      FROM lumbung.batch_balances bb
     GROUP BY bb.tenant_id, bb.batch_id
  )
  SELECT b.tenant_id,
         b.id AS batch_id,
         b.batch_code,
         b.product_id,
         b.restriction,
         coalesce(b.expires_at, b.handling_deadline) AS usable_until,
         coalesce(bal.available_qty, 0)      AS available_qty,
         coalesce(bal.reserved_qty, 0)       AS reserved_qty,
         coalesce(bal.quarantine_qty, 0)     AS quarantine_qty,
         coalesce(bal.in_transit_qty, 0)     AS in_transit_qty,
         coalesce(bal.return_pending_qty, 0) AS return_pending_qty,
         CASE
           WHEN b.restriction = 'RECALL_HOLD' THEN 'RECALL_HOLD'
           WHEN b.restriction = 'QUARANTINED' THEN 'QUARANTINED'
           WHEN coalesce(bal.available_qty, 0) + coalesce(bal.reserved_qty, 0) + coalesce(bal.quarantine_qty, 0) = 0
             THEN 'DEPLETED'
           WHEN coalesce(bal.available_qty, 0) + coalesce(bal.reserved_qty, 0) = 0 THEN 'QUARANTINED'
           WHEN coalesce(b.expires_at, b.handling_deadline) <= lumbung.tenant_now_at(b.tenant_id) THEN 'EXPIRED'
           WHEN coalesce(bal.reserved_qty, 0) > 0 AND coalesce(bal.available_qty, 0) = 0 THEN 'FULLY_RESERVED'
           WHEN coalesce(bal.reserved_qty, 0) > 0 THEN 'PARTIALLY_RESERVED'
           ELSE 'AVAILABLE'
         END AS status
    FROM lumbung.inventory_batches b
    LEFT JOIN bal ON bal.tenant_id = b.tenant_id AND bal.batch_id = b.id;
