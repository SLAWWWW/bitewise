-- 0008_delivery_receipts: deliveries, lines, FLO receipts (with correction
-- chain), receipt lines (the fairness receipt ledger), distribution events.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.deliveries (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code                text NOT NULL,
  route               text NOT NULL CHECK (route IN ('DIRECT','WAREHOUSE_OUTBOUND')),
  source_location_id  uuid NOT NULL,
  destination_flo_id  uuid NOT NULL,
  state               text NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED','READY_FOR_PICKUP','PICKED_UP',
                        'IN_TRANSIT','RECEIVED','PARTIALLY_RECEIVED','FAILED','RETURN_PENDING','RESOLVED_EXCEPTION','CANCELLED')),
  custodian           text,
  planned_pickup_at   timestamptz,
  picked_up_at        timestamptz,
  dispatched_at       timestamptz,
  planned_arrival_at  timestamptz,
  arrived_at          timestamptz,
  received_at         timestamptz,
  revision            integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, source_location_id) REFERENCES lumbung.source_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, destination_flo_id) REFERENCES lumbung.flos(tenant_id, id),
  CHECK (received_at IS NULL OR dispatched_at IS NULL OR received_at >= dispatched_at),
  CHECK (state NOT IN ('PICKED_UP','IN_TRANSIT','RECEIVED','PARTIALLY_RECEIVED') OR dispatched_at IS NOT NULL)
);
CREATE INDEX deliveries_state_idx ON lumbung.deliveries (tenant_id, state);
CREATE INDEX deliveries_flo_idx ON lumbung.deliveries (tenant_id, destination_flo_id, dispatched_at);

CREATE TABLE lumbung.delivery_lines (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  delivery_id     uuid NOT NULL,
  allocation_id   uuid NOT NULL,
  item_id         uuid,
  batch_id        uuid,                 -- FK added in 0009
  product_id      uuid,
  category_id     uuid NOT NULL,
  unit            text NOT NULL,
  unit_kind       text NOT NULL CHECK (unit_kind IN ('COUNT','MASS','VOLUME')),
  offered_qty     numeric(14,3) CHECK (offered_qty > 0),
  allocated_qty   numeric(14,3) NOT NULL CHECK (allocated_qty > 0),
  dispatched_qty  numeric(14,3) CHECK (dispatched_qty >= 0),
  picked_qty      numeric(14,3) CHECK (picked_qty >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, delivery_id) REFERENCES lumbung.deliveries(tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES lumbung.allocations(tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES lumbung.donation_items(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES lumbung.products(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id),
  CHECK (num_nonnulls(item_id, batch_id) <= 1),
  CHECK (unit_kind <> 'COUNT' OR (allocated_qty = trunc(allocated_qty)
         AND (dispatched_qty IS NULL OR dispatched_qty = trunc(dispatched_qty))))
);
CREATE INDEX delivery_lines_delivery_idx ON lumbung.delivery_lines (tenant_id, delivery_id);
CREATE INDEX delivery_lines_allocation_idx ON lumbung.delivery_lines (tenant_id, allocation_id);

CREATE TABLE lumbung.flo_receipts (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  delivery_id          uuid NOT NULL,
  flo_id               uuid NOT NULL,
  received_at          timestamptz NOT NULL,
  time_source          text NOT NULL,
  recorded_by_actor    uuid,
  bast_media_id        uuid,
  corrects_receipt_id  uuid UNIQUE,
  status               text NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT','SUPERSEDED')),
  origin               text NOT NULL DEFAULT 'LOCAL' CHECK (origin IN ('LOCAL','IMPORT')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, delivery_id) REFERENCES lumbung.deliveries(tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, bast_media_id) REFERENCES lumbung.media_files(tenant_id, id),
  FOREIGN KEY (tenant_id, corrects_receipt_id) REFERENCES lumbung.flo_receipts(tenant_id, id),
  CHECK (corrects_receipt_id IS NULL OR corrects_receipt_id <> id)
);
CREATE INDEX flo_receipts_delivery_idx ON lumbung.flo_receipts (tenant_id, delivery_id);
CREATE INDEX flo_receipts_flo_idx ON lumbung.flo_receipts (tenant_id, flo_id, received_at);

-- accepted + rejected <= dispatched is enforced by receive_delivery and
-- checked by verify_tenant_invariants (it spans rows).
CREATE TABLE lumbung.receipt_lines (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  receipt_id          uuid NOT NULL,
  delivery_line_id    uuid NOT NULL,
  flo_id              uuid NOT NULL,
  category_id         uuid NOT NULL,
  unit                text NOT NULL,
  received_at         timestamptz NOT NULL,
  accepted_qty        numeric(14,3) NOT NULL CHECK (accepted_qty >= 0),
  rejected_qty        numeric(14,3) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  discrepancy_reason  text,
  is_current          boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES lumbung.flo_receipts(tenant_id, id),
  FOREIGN KEY (tenant_id, delivery_line_id) REFERENCES lumbung.delivery_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id),
  CHECK (rejected_qty = 0 OR discrepancy_reason IS NOT NULL)
);
CREATE INDEX receipt_lines_ledger_idx ON lumbung.receipt_lines (tenant_id, flo_id, category_id, received_at) WHERE is_current;
CREATE INDEX receipt_lines_delivery_line_idx ON lumbung.receipt_lines (tenant_id, delivery_line_id);

CREATE TABLE lumbung.distribution_events (
  id                      uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id                  uuid NOT NULL,
  receipt_id              uuid NOT NULL,
  occurred_at             timestamptz NOT NULL,
  occurrence_time_source  text NOT NULL,
  reported_at             timestamptz NOT NULL,
  people_reported         integer CHECK (people_reported >= 0),
  planned                 boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES lumbung.flo_receipts(tenant_id, id)
);
CREATE INDEX distribution_events_receipt_idx ON lumbung.distribution_events (tenant_id, receipt_id);

CREATE TABLE lumbung.distribution_event_lines (
  id                      uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  event_id                uuid NOT NULL,
  receipt_line_id         uuid NOT NULL,
  distributed_qty         numeric(14,3) NOT NULL CHECK (distributed_qty >= 0),
  remaining_qty_snapshot  numeric(14,3) CHECK (remaining_qty_snapshot >= 0),
  loss_disposed_qty       numeric(14,3) NOT NULL DEFAULT 0 CHECK (loss_disposed_qty >= 0),
  reported_consumed_qty   numeric(14,3) CHECK (reported_consumed_qty >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_id, receipt_line_id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES lumbung.distribution_events(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_line_id) REFERENCES lumbung.receipt_lines(tenant_id, id)
);
