-- 0007_donations_allocation: donation orders/items, safety evaluations,
-- allocation runs, outreach campaigns, allocations, offers, reservations,
-- transport arrangements, approvals.
-- Quantities: numeric(14,3) > 0; COUNT units must be whole (unit_kind
-- denormalised on lines). Money: integer IDR.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.donation_orders (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code               text NOT NULL,
  donor_id           uuid NOT NULL,
  source_location_id uuid,
  route              text NOT NULL CHECK (route IN ('DIRECT','WAREHOUSE_INBOUND')),
  intake_channel     text NOT NULL CHECK (intake_channel IN ('MANUAL','CSV','MESSAGE','PROVIDER')),
  donation_reason    text CHECK (donation_reason IN ('SURPLUS','NEAR_EXPIRY','COSMETIC_PRODUCE',
                       'OUTER_PACKAGING_DAMAGE','PRODUCTION_EXCESS','OTHER')),
  pickup_start       timestamptz,
  pickup_end         timestamptz,
  operational_state  text NOT NULL DEFAULT 'DRAFT' CHECK (operational_state IN ('DRAFT','NEEDS_INFO',
                       'SAFETY_REVIEW','READY','ALLOCATING','PARTIALLY_ALLOCATED','FULLY_ALLOCATED','CLOSED','CANCELLED')),
  reporting_state    text,
  external_ref       text,
  revision           integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, donor_id) REFERENCES lumbung.donors(tenant_id, id),
  FOREIGN KEY (tenant_id, source_location_id) REFERENCES lumbung.source_locations(tenant_id, id),
  CHECK (pickup_end > pickup_start)
);
CREATE INDEX donation_orders_state_idx ON lumbung.donation_orders (tenant_id, operational_state);

CREATE TABLE lumbung.donation_items (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  order_id            uuid NOT NULL,
  line_no             integer NOT NULL CHECK (line_no > 0),
  product_id          uuid,
  category_id         uuid,
  description         text,
  quantity            numeric(14,3) CHECK (quantity > 0),
  unit                text,
  unit_kind           text CHECK (unit_kind IN ('COUNT','MASS','VOLUME')),
  conversion_id       uuid,
  est_weight_kg       numeric(14,3) CHECK (est_weight_kg >= 0),
  measured_weight_kg  numeric(14,3) CHECK (measured_weight_kg >= 0),
  weight_provenance   text CHECK (weight_provenance IN ('ESTIMATED','MEASURED')),
  condition           text,
  storage_req         text CHECK (storage_req IN ('AMBIENT','CHILLED','FROZEN')),
  prep_info           jsonb,
  label_info          jsonb,
  distribute_by       timestamptz,
  safety_state        text NOT NULL DEFAULT 'PENDING' CHECK (safety_state IN ('PENDING','CLEARED','REVIEW_REQUIRED','REJECTED')),
  parse               jsonb,
  missing_fields      text[] NOT NULL DEFAULT '{}',
  revision            integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_id, line_no),
  FOREIGN KEY (tenant_id, order_id) REFERENCES lumbung.donation_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES lumbung.products(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id),
  FOREIGN KEY (tenant_id, conversion_id) REFERENCES lumbung.unit_conversions(tenant_id, id),
  CHECK (unit_kind IS DISTINCT FROM 'COUNT' OR quantity = trunc(quantity)),
  CHECK (quantity IS NULL OR unit IS NOT NULL)
);

CREATE TABLE lumbung.safety_evaluations (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  subject_type           text NOT NULL CHECK (subject_type IN ('ITEM','BATCH')),
  subject_id             uuid NOT NULL,
  policy_version_id      uuid NOT NULL,
  inputs_hash            text NOT NULL,
  deterministic_verdict  text NOT NULL CHECK (deterministic_verdict IN ('CLEARED','REVIEW_REQUIRED','REJECTED')),
  ai_proposed_verdict    text CHECK (ai_proposed_verdict IN ('CLEARED','REVIEW_REQUIRED','REJECTED')),
  verdict                text NOT NULL CHECK (verdict IN ('CLEARED','REVIEW_REQUIRED','REJECTED')),
  reasons                text[] NOT NULL DEFAULT '{}',
  usable_until           timestamptz,
  reviewer_id            uuid REFERENCES lumbung.users(id),
  reviewed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES lumbung.policy_versions(tenant_id, id),
  -- INV03: AI may only tighten; a deterministic failure cannot be loosened.
  CHECK (deterministic_verdict <> 'REJECTED' OR verdict = 'REJECTED'),
  CHECK (deterministic_verdict <> 'REVIEW_REQUIRED' OR verdict <> 'CLEARED' OR reviewer_id IS NOT NULL)
);
CREATE INDEX safety_evaluations_subject_idx ON lumbung.safety_evaluations (tenant_id, subject_id, created_at);

CREATE TABLE lumbung.allocation_runs (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  item_id            uuid,
  item_revision      integer,
  policy_version_id  uuid NOT NULL,
  planning_date      date NOT NULL,
  horizon_start      timestamptz NOT NULL,
  horizon_end        timestamptz NOT NULL,
  now_at             timestamptz NOT NULL,
  feature_snapshot   jsonb NOT NULL,
  result             jsonb NOT NULL,
  facts_hash         text NOT NULL,
  mode               text NOT NULL DEFAULT 'SIMULATED' CHECK (mode IN ('SIMULATED','LIVE')),
  agent_run_id       uuid,             -- FK added in 0010
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES lumbung.donation_items(tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES lumbung.policy_versions(tenant_id, id),
  CHECK (horizon_end > horizon_start)
);

CREATE TABLE lumbung.outreach_campaigns (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  item_id              uuid,
  release_plan_id      uuid,           -- FK added in 0009
  source_type          text NOT NULL CHECK (source_type IN ('DIRECT_ITEM','BATCH')),
  allocation_run_id    uuid,
  state                text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','AWAITING_APPROVAL','APPROVED',
                         'RUNNING','PAUSED','COMPLETED','EXPIRED','CANCELLED')),
  revision             integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  plan_hash            text,
  response_window_min  integer NOT NULL CHECK (response_window_min > 0),
  expansion_bands      text[] NOT NULL DEFAULT '{}',
  template_version     text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES lumbung.donation_items(tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_run_id) REFERENCES lumbung.allocation_runs(tenant_id, id),
  CHECK (source_type <> 'DIRECT_ITEM' OR item_id IS NOT NULL)
);
CREATE INDEX outreach_campaigns_state_idx ON lumbung.outreach_campaigns (tenant_id, state);

CREATE TABLE lumbung.campaign_lines (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  campaign_id            uuid NOT NULL,
  campaign_revision      integer NOT NULL CHECK (campaign_revision > 0),
  flo_id                 uuid NOT NULL,
  wave_no                integer NOT NULL CHECK (wave_no > 0),
  rank                   integer NOT NULL CHECK (rank > 0),
  max_qty                numeric(14,3) NOT NULL CHECK (max_qty > 0),
  unit                   text NOT NULL,
  receiving_start        timestamptz NOT NULL,
  receiving_end          timestamptz NOT NULL,
  distribution_deadline  timestamptz NOT NULL,
  planned_receipt_at     timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, campaign_revision, flo_id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES lumbung.outreach_campaigns(tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  CHECK (receiving_end > receiving_start)
);

CREATE TABLE lumbung.allocations (
  id                       uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code                     text NOT NULL,
  item_id                  uuid,
  release_plan_id          uuid,         -- FK added in 0009
  source_type              text NOT NULL CHECK (source_type IN ('DIRECT_ITEM','BATCH')),
  flo_id                   uuid NOT NULL,
  category_id              uuid NOT NULL,
  quantity                 numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit                     text NOT NULL,
  unit_kind                text NOT NULL CHECK (unit_kind IN ('COUNT','MASS','VOLUME')),
  state                    text NOT NULL DEFAULT 'PROPOSED' CHECK (state IN ('PROPOSED','OFFER_HELD','ACCEPTED_RESERVED',
                             'LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED','DISPATCHED','PARTIALLY_RECEIVED',
                             'RECEIVED','CANCELLED','EXPIRED','EXCEPTION')),
  cancel_reason            text,
  chosen_run_id            uuid,
  campaign_id              uuid,
  manual_approval_id       uuid,         -- FK added below (approvals)
  planned_pickup_start     timestamptz,
  planned_pickup_end       timestamptz,
  planned_receipt_at       timestamptz,
  planned_distribution_at  timestamptz,
  planned_service_date     date,
  revision                 integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, item_id) REFERENCES lumbung.donation_items(tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id),
  FOREIGN KEY (tenant_id, chosen_run_id) REFERENCES lumbung.allocation_runs(tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES lumbung.outreach_campaigns(tenant_id, id),
  CHECK (unit_kind <> 'COUNT' OR quantity = trunc(quantity)),
  CHECK (source_type <> 'DIRECT_ITEM' OR item_id IS NOT NULL),
  CHECK (planned_pickup_end IS NULL OR planned_pickup_start IS NULL OR planned_pickup_end > planned_pickup_start),
  -- INV01 traceability: anything beyond PROPOSED traces to an outreach scope
  -- or an explicitly approved manual allocation.
  CHECK (campaign_id IS NOT NULL OR manual_approval_id IS NOT NULL OR state = 'PROPOSED'),
  CHECK (state NOT IN ('CANCELLED') OR cancel_reason IS NOT NULL)
);
CREATE INDEX allocations_flo_category_idx ON lumbung.allocations (tenant_id, flo_id, category_id, state);
CREATE INDEX allocations_item_idx ON lumbung.allocations (tenant_id, item_id);
CREATE INDEX allocations_state_idx ON lumbung.allocations (tenant_id, state);

CREATE TABLE lumbung.offers (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code                 text NOT NULL,
  campaign_id          uuid NOT NULL,
  campaign_line_id     uuid NOT NULL,
  campaign_revision    integer NOT NULL CHECK (campaign_revision > 0),
  allocation_id        uuid NOT NULL,
  flo_id               uuid NOT NULL,
  contact_id           uuid,
  quantity             numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit                 text NOT NULL,
  state                text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','HELD','QUEUED','SENT','DELIVERED',
                         'ACCEPTED','PARTIALLY_ACCEPTED','DECLINED','EXPIRED','CANCELLED','SEND_FAILED','DELIVERY_UNKNOWN')),
  response_deadline    timestamptz,
  expires_at           timestamptz,
  queued_at            timestamptz,
  sent_at              timestamptz,
  delivery_receipt_at  timestamptz,
  responded_at         timestamptz,
  response_kind        text CHECK (response_kind IN ('ACCEPT','PARTIAL_ACCEPT','DECLINE','QUESTION')),
  decline_reason_code  text,
  accepted_qty         numeric(14,3) CHECK (accepted_qty >= 0),
  r_eligible           boolean,
  r_timely             boolean,
  r_exclusion          text CHECK (r_exclusion IN ('OUTAGE','PHONE_FAILURE','CLOSURE','STAFF_CANCELLED','NO_DELIVERY_RECEIPT')),
  outbox_id            uuid,            -- FK added in 0010
  revision             integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES lumbung.outreach_campaigns(tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_line_id) REFERENCES lumbung.campaign_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES lumbung.allocations(tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES lumbung.flo_contacts(tenant_id, id),
  CHECK (accepted_qty IS NULL OR accepted_qty <= quantity)
);
-- One live offer per FLO per campaign.
CREATE UNIQUE INDEX offers_one_live_per_flo
  ON lumbung.offers (tenant_id, campaign_id, flo_id)
  WHERE state IN ('DRAFT','HELD','QUEUED','SENT','DELIVERED');
CREATE INDEX offers_flo_idx ON lumbung.offers (tenant_id, flo_id, created_at);
CREATE INDEX offers_expiry_idx ON lumbung.offers (tenant_id, state, expires_at);

CREATE TABLE lumbung.reservations (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('HOLD','RESERVATION')),
  source_type      text NOT NULL CHECK (source_type IN ('DIRECT_ITEM','BATCH')),
  allocation_id    uuid NOT NULL,
  offer_id         uuid,
  state            text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','RELEASED','CONSUMED','EXPIRED')),
  expires_at       timestamptz,
  released_reason  text,
  revision         integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES lumbung.allocations(tenant_id, id),
  FOREIGN KEY (tenant_id, offer_id) REFERENCES lumbung.offers(tenant_id, id),
  CHECK (state <> 'RELEASED' OR released_reason IS NOT NULL)
);
CREATE INDEX reservations_allocation_idx ON lumbung.reservations (tenant_id, allocation_id);
CREATE INDEX reservations_active_expiry_idx ON lumbung.reservations (tenant_id, expires_at) WHERE state = 'ACTIVE';

CREATE TABLE lumbung.reservation_lines (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  reservation_id  uuid NOT NULL,
  item_id         uuid,
  batch_id        uuid,                 -- FK added in 0009
  quantity        numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit            text NOT NULL,
  state           text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','RELEASED','CONSUMED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, reservation_id) REFERENCES lumbung.reservations(tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES lumbung.donation_items(tenant_id, id),
  CHECK (num_nonnulls(item_id, batch_id) = 1)
);
CREATE INDEX reservation_lines_item_active_idx ON lumbung.reservation_lines (tenant_id, item_id) WHERE state = 'ACTIVE';
CREATE INDEX reservation_lines_batch_active_idx ON lumbung.reservation_lines (tenant_id, batch_id) WHERE state = 'ACTIVE';

CREATE TABLE lumbung.transport_arrangements (
  id                       uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  allocation_id            uuid NOT NULL,
  method                   text NOT NULL CHECK (method IN ('SELF_PICKUP','FLO_BOOKED_COURIER','FOODCYCLE_COORDINATED_COURIER')),
  arranger                 text,
  payer                    text NOT NULL DEFAULT 'FLO' CHECK (payer IN ('FLO','FOODCYCLE','DONOR')),
  quote_status             text NOT NULL CHECK (quote_status IN ('NOT_APPLICABLE','AWAITING_QUOTE','QUOTED','CONFIRMED','REFUSED')),
  estimated_fee_idr        integer CHECK (estimated_fee_idr >= 0),
  confirmed_fee_idr        integer CHECK (confirmed_fee_idr >= 0),
  currency                 char(3) NOT NULL DEFAULT 'IDR',
  fee_accepted_at          timestamptz,
  fee_accepted_contact_id  uuid,
  fee_refused_at           timestamptz,
  revision                 integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, allocation_id),
  FOREIGN KEY (tenant_id, allocation_id) REFERENCES lumbung.allocations(tenant_id, id),
  FOREIGN KEY (tenant_id, fee_accepted_contact_id) REFERENCES lumbung.flo_contacts(tenant_id, id),
  CHECK (method <> 'SELF_PICKUP' OR quote_status = 'NOT_APPLICABLE'),
  CHECK (quote_status <> 'CONFIRMED' OR confirmed_fee_idr IS NOT NULL),
  CHECK (fee_accepted_at IS NULL OR fee_refused_at IS NULL)
);

CREATE TABLE lumbung.approvals (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  stage               text NOT NULL CHECK (stage IN ('OUTREACH','FINAL_DISPATCH','MANUAL_ALLOCATION','ADJUSTMENT',
                        'QUARANTINE_RELEASE','RECEIPT_CORRECTION','POLICY')),
  subject_type        text NOT NULL,
  subject_id          uuid NOT NULL,
  subject_revision    integer NOT NULL CHECK (subject_revision > 0),
  input_hash          text NOT NULL,
  approver_id         uuid NOT NULL REFERENCES lumbung.users(id),
  approved_at         timestamptz NOT NULL,
  expires_at          timestamptz,
  reason              text,
  invalidated_at      timestamptz,
  invalidated_reason  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((invalidated_at IS NULL) = (invalidated_reason IS NULL))
);
CREATE INDEX approvals_current_idx ON lumbung.approvals (tenant_id, subject_id, stage) WHERE invalidated_at IS NULL;
CREATE INDEX approvals_subject_idx ON lumbung.approvals (tenant_id, subject_id, stage, approved_at);

ALTER TABLE lumbung.allocations
  ADD FOREIGN KEY (tenant_id, manual_approval_id) REFERENCES lumbung.approvals(tenant_id, id);
