-- 0005_agreements: agreement versions, renewal tasks, validity helpers.
--
-- Intervals are [valid_from, valid_until_exclusive) instants derived from the
-- local legal dates in the tenant time zone: valid_from = from_date 00:00,
-- valid_until_exclusive = (through_date + 1) 00:00. A handover exactly at the
-- exclusive end is invalid. The PRD lifecycle (ACTIVE / EXPIRED / SCHEDULED)
-- is derived by agreement_status(a, t) so stored state cannot lag the clock.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.agreements (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id                 uuid NOT NULL,
  document_media_id      uuid,            -- FK added in 0006
  version                integer NOT NULL DEFAULT 1 CHECK (version > 0),
  signed_date            date,
  valid_from_date        date NOT NULL,
  valid_through_date     date NOT NULL,
  valid_from             timestamptz NOT NULL,
  valid_until_exclusive  timestamptz NOT NULL,
  review_state           text NOT NULL DEFAULT 'PENDING_VERIFICATION'
                         CHECK (review_state IN ('PENDING_VERIFICATION','APPROVED','REJECTED','REVOKED','SUPERSEDED')),
  uploaded_by            uuid REFERENCES lumbung.users(id),
  reviewer_id            uuid REFERENCES lumbung.users(id),
  reviewed_at            timestamptz,
  revoked_at             timestamptz,
  revoke_reason          text,
  supersedes_id          uuid,
  revision               integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES lumbung.agreements(tenant_id, id),
  CHECK (valid_until_exclusive > valid_from),
  CHECK (valid_through_date >= valid_from_date),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  CHECK (review_state NOT IN ('APPROVED','REJECTED','REVOKED','SUPERSEDED')
         OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (review_state <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);
CREATE INDEX agreements_approved_interval_idx
  ON lumbung.agreements (tenant_id, flo_id, valid_from, valid_until_exclusive)
  WHERE review_state = 'APPROVED';
CREATE INDEX agreements_flo_idx ON lumbung.agreements (tenant_id, flo_id, version);

CREATE TABLE lumbung.renewal_tasks (
  id                      uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  agreement_id            uuid NOT NULL,
  offset_days             integer NOT NULL CHECK (offset_days IN (30,14,7)),
  due_at                  timestamptz NOT NULL,
  status                  text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
  submitted_agreement_id  uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, agreement_id, offset_days),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES lumbung.agreements(tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_agreement_id) REFERENCES lumbung.agreements(tenant_id, id)
);
CREATE INDEX renewal_tasks_due_idx ON lumbung.renewal_tasks (tenant_id, status, due_at);

-- The APPROVED agreement of an explicit tenant covering instant p_t, or NULL.
-- Owner-only (used by verify_tenant_invariants and the seed).
CREATE FUNCTION lumbung.agreement_valid_at_for(p_tenant uuid, p_flo uuid, p_t timestamptz) RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT a.id
      FROM lumbung.agreements a
     WHERE a.tenant_id = p_tenant
       AND a.flo_id = p_flo
       AND a.review_state = 'APPROVED'
       AND a.valid_from <= p_t
       AND p_t < a.valid_until_exclusive
     ORDER BY a.valid_from DESC, a.id
     LIMIT 1
  $$;

-- Same, in the current tenant context (granted to the app).
CREATE FUNCTION lumbung.agreement_valid_at(p_flo uuid, p_t timestamptz) RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT lumbung.agreement_valid_at_for(lumbung.current_tenant(), p_flo, p_t) $$;

-- Derived lifecycle state at instant t:
--   PENDING_VERIFICATION | REJECTED | REVOKED | SUPERSEDED  (review outcome)
--   SCHEDULED  approved, t <  valid_from
--   ACTIVE     approved, valid_from <= t < valid_until_exclusive
--   EXPIRED    approved, t >= valid_until_exclusive
-- EXPIRING_SOON is a badge on ACTIVE, see agreement_is_expiring_soon().
CREATE FUNCTION lumbung.agreement_status(a lumbung.agreements, t timestamptz) RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT CASE
      WHEN a.review_state <> 'APPROVED' THEN a.review_state
      WHEN t < a.valid_from THEN 'SCHEDULED'
      WHEN t >= a.valid_until_exclusive THEN 'EXPIRED'
      ELSE 'ACTIVE'
    END
  $$;

-- ACTIVE with at most p_window left until the exclusive end (default 30 days,
-- matching the seed classifier: end - T > 30d is "ACTIVE_GT30").
CREATE FUNCTION lumbung.agreement_is_expiring_soon(
    a lumbung.agreements, t timestamptz, p_window interval DEFAULT interval '30 days') RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT lumbung.agreement_status(a, t) = 'ACTIVE'
       AND a.valid_until_exclusive - t <= p_window
  $$;
