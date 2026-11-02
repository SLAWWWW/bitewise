-- 0002_tenancy_security: tenants, users, memberships, clock, policies,
-- activation decisions, idempotency, audit/events, tasks, FLO links,
-- context guards (require_ctx / require_cap) and the tenant clock.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text NOT NULL CHECK (length(name) > 0),
  timezone    text NOT NULL DEFAULT 'Asia/Jakarta',
  mode        text NOT NULL CHECK (mode IN ('DEMO','TEST','LIVE')),
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (mode <> 'LIVE' OR NOT is_demo)
);

-- Global identities (not tenant-scoped). Visible to the app only through a
-- membership in the current tenant (RLS, 0012). Synthetic: *@example.invalid.
CREATE TABLE lumbung.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL CHECK (length(display_name) > 0),
  email         text UNIQUE,
  kind          text NOT NULL DEFAULT 'HUMAN' CHECK (kind IN ('HUMAN','SERVICE')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lumbung.memberships (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES lumbung.users(id),
  role_label    text NOT NULL,
  capabilities  text[] NOT NULL DEFAULT '{}'
                CHECK (capabilities <@ lumbung.known_capabilities()),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);

-- Simulated clock per tenant: FROZEN = sim_anchor; TICKING = sim_anchor +
-- (now() - real_anchor); REAL = now(). Commands never accept a caller "now".
CREATE TABLE lumbung.tenant_clocks (
  tenant_id    uuid PRIMARY KEY REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  mode         text NOT NULL CHECK (mode IN ('FROZEN','TICKING','REAL')),
  sim_anchor   timestamptz,
  real_anchor  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (mode = 'REAL' OR sim_anchor IS NOT NULL),
  CHECK (mode <> 'TICKING' OR real_anchor IS NOT NULL)
);

CREATE TABLE lumbung.policy_versions (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('ALLOCATION','SAFETY','REPORTING','LOGISTICS','OUTREACH','RETENTION')),
  code           text NOT NULL,
  version        text NOT NULL,
  body           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED_DEMO','APPROVED_LIVE','RETIRED')),
  approved_by    uuid REFERENCES lumbung.users(id),
  approved_at    timestamptz,
  supersedes_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES lumbung.policy_versions(tenant_id, id),
  CHECK (status NOT IN ('APPROVED_DEMO','APPROVED_LIVE') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

CREATE TABLE lumbung.tenant_active_policies (
  tenant_id          uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('ALLOCATION','SAFETY','REPORTING','LOGISTICS','OUTREACH','RETENTION')),
  policy_version_id  uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES lumbung.policy_versions(tenant_id, id)
);

-- PRD §27: the 10 production activation decisions.
CREATE TABLE lumbung.activation_decisions (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  key          text NOT NULL CHECK (key IN (
                 'REGISTRY_SOURCE_OF_TRUTH',
                 'WAREHOUSE_STOCK_CONTRACT',
                 'EVIDENCE_DEADLINE_POLICY',
                 'SAFETY_PROFILES',
                 'NEED_SCORING',
                 'COURIER_FEE_PROCESS',
                 'CONTACT_PERMISSIONS',
                 'MEDIA_POLICY',
                 'APPROVAL_ROLES',
                 'HOSTING_OPERATIONS')),
  status       text NOT NULL DEFAULT 'NOT_DECIDED' CHECK (status IN ('NOT_DECIDED','APPROVED')),
  approved_by  uuid REFERENCES lumbung.users(id),
  approved_at  timestamptz,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, key),
  CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

-- Command idempotency (A.2). Owner-only table: no app grant at all.
CREATE TABLE lumbung.idempotency_keys (
  tenant_id     uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  command       text NOT NULL,
  request_hash  text NOT NULL,
  actor_id      uuid,
  status        text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response      jsonb,
  http_status   integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  PRIMARY KEY (tenant_id, key),
  CHECK (status <> 'COMPLETED' OR response IS NOT NULL)
);

CREATE TABLE lumbung.audit_events (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  actor_id           uuid,
  actor_kind         text NOT NULL CHECK (actor_kind IN ('USER','WORKER','AGENT','FLO_LINK','SYSTEM')),
  action             text NOT NULL,
  subject_type       text NOT NULL,
  subject_id         uuid,
  subject_revision   integer,
  policy_version_id  uuid,
  reason             text,
  before_hash        text,
  after_hash         text,
  correlation_id     text,
  occurred_at        timestamptz NOT NULL,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES lumbung.policy_versions(tenant_id, id)
);
CREATE INDEX audit_events_subject_idx ON lumbung.audit_events (tenant_id, subject_id, occurred_at);
CREATE INDEX audit_events_occurred_idx ON lumbung.audit_events (tenant_id, occurred_at, id);
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON lumbung.audit_events
  FOR EACH ROW EXECUTE FUNCTION lumbung.tg_append_only();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON lumbung.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION lumbung.tg_append_only();

CREATE TABLE lumbung.domain_events (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  type             text NOT NULL,
  object_type      text NOT NULL,
  object_id        uuid,
  object_revision  integer,
  occurred_at      timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  correlation_id   text,
  payload_version  integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  UNIQUE (tenant_id, id)
);
CREATE INDEX domain_events_object_idx ON lumbung.domain_events (tenant_id, object_id, occurred_at);
CREATE INDEX domain_events_type_idx ON lumbung.domain_events (tenant_id, type, occurred_at);
CREATE TRIGGER domain_events_append_only BEFORE UPDATE OR DELETE ON lumbung.domain_events
  FOR EACH ROW EXECUTE FUNCTION lumbung.tg_append_only();
CREATE TRIGGER domain_events_no_truncate BEFORE TRUNCATE ON lumbung.domain_events
  FOR EACH STATEMENT EXECUTE FUNCTION lumbung.tg_append_only();

CREATE TABLE lumbung.tasks (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]*$'),
  subject_type  text,
  subject_id    uuid,
  severity      text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  state         text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','CLAIMED','DONE','CANCELLED')),
  assignee_id   uuid REFERENCES lumbung.users(id),
  due_at        timestamptz,
  dedup_key     text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at   timestamptz,
  resolution    text,
  revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dedup_key)
);
CREATE INDEX tasks_open_idx ON lumbung.tasks (tenant_id, state, due_at);
CREATE INDEX tasks_subject_idx ON lumbung.tasks (tenant_id, subject_id);

-- Scoped FLO links (/f/[token]). Only the sha256 of the token is stored.
-- FKs to flos / flo_contacts are added in 0004 once those tables exist.
CREATE TABLE lumbung.flo_access_links (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id        uuid NOT NULL,
  contact_id    uuid,
  subject_type  text NOT NULL,
  subject_id    uuid,
  actions       text[] NOT NULL CHECK (cardinality(actions) > 0
                  AND actions <@ lumbung.actor_kind_allowlist('FLO_LINK')),
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  used_count    integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX flo_access_links_flo_idx ON lumbung.flo_access_links (tenant_id, flo_id);

-- ---------------------------------------------------------------------------
-- Tenant clock
-- ---------------------------------------------------------------------------
CREATE FUNCTION lumbung.tenant_now_for(c lumbung.tenant_clocks) RETURNS timestamptz
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT CASE c.mode
      WHEN 'FROZEN'  THEN c.sim_anchor
      WHEN 'TICKING' THEN c.sim_anchor + (now() - c.real_anchor)
      ELSE now()
    END
  $$;

-- Clock of an explicit tenant (worker claim loops, views). Without a clock
-- row the tenant runs on the real clock (verify_tenant_invariants flags
-- DEMO/TEST tenants that lack one).
CREATE FUNCTION lumbung.tenant_now_at(p_tenant uuid) RETURNS timestamptz
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT coalesce(
      (SELECT lumbung.tenant_now_for(c) FROM lumbung.tenant_clocks c WHERE c.tenant_id = p_tenant),
      now())
  $$;

CREATE FUNCTION lumbung.tenant_now() RETURNS timestamptz
  LANGUAGE plpgsql STABLE
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := lumbung.current_tenant();
  BEGIN
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:CONTEXT_REQUIRED',
        DETAIL = '{"reason":"NO_TENANT"}';
    END IF;
    RETURN lumbung.tenant_now_at(v_tenant);
  END
  $$;

-- ---------------------------------------------------------------------------
-- Context guards
-- ---------------------------------------------------------------------------

-- require_ctx(): a tenant context is set, the tenant exists (and is visible),
-- the actor kind is valid; USER actors need an ACTIVE membership; FLO_LINK
-- actors need a link id (the link itself is validated by require_cap).
-- Returns the tenant id. SECURITY INVOKER: as lumbung_app the lookups are
-- additionally RLS-filtered; every lookup also filters tenant explicitly.
CREATE FUNCTION lumbung.require_ctx() RETURNS uuid
  LANGUAGE plpgsql STABLE
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := lumbung.current_tenant();
    v_kind   text := lumbung.current_actor_kind();
    v_user   uuid := lumbung.current_user_id();
  BEGIN
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:CONTEXT_REQUIRED',
        DETAIL = '{"reason":"NO_TENANT"}';
    END IF;
    IF v_kind IS NULL OR v_kind NOT IN ('USER','WORKER','AGENT','FLO_LINK','SYSTEM') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:CONTEXT_REQUIRED',
        DETAIL = json_build_object('reason', 'BAD_ACTOR_KIND', 'actor_kind', v_kind)::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM lumbung.tenants t WHERE t.id = v_tenant) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:CONTEXT_REQUIRED',
        DETAIL = '{"reason":"TENANT_UNKNOWN"}';
    END IF;
    IF v_kind = 'USER' THEN
      IF v_user IS NULL OR NOT EXISTS (
        SELECT 1 FROM lumbung.memberships m
         WHERE m.tenant_id = v_tenant AND m.user_id = v_user AND m.status = 'ACTIVE') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:FORBIDDEN',
          DETAIL = '{"reason":"NO_ACTIVE_MEMBERSHIP"}';
      END IF;
    ELSIF v_kind = 'FLO_LINK' AND lumbung.current_link_id() IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:CONTEXT_REQUIRED',
        DETAIL = '{"reason":"NO_LINK"}';
    END IF;
    RETURN v_tenant;
  END
  $$;

-- require_cap(cap): capabilities are never trusted from a GUC.
--   USER      -> ACTIVE membership in the current tenant containing cap
--   FLO_LINK  -> unrevoked, unexpired (tenant clock) link of this tenant whose
--                actions contain cap (and cap within the FLO_LINK allowlist)
--   WORKER / AGENT / SYSTEM -> fixed allowlist (actor_kind_allowlist)
-- SECURITY DEFINER because the app role cannot read flo_access_links.
CREATE FUNCTION lumbung.require_cap(p_cap text) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := lumbung.require_ctx();
    v_kind   text := lumbung.current_actor_kind();
    v_ok     boolean;
    v_reason text := 'CAPABILITY_MISSING';
  BEGIN
    IF p_cap IS NULL OR NOT (p_cap = ANY (lumbung.known_capabilities())) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:UNKNOWN_CAPABILITY',
        DETAIL = json_build_object('capability', p_cap)::text;
    END IF;

    IF v_kind = 'USER' THEN
      SELECT true INTO v_ok
        FROM lumbung.memberships m
       WHERE m.tenant_id = v_tenant
         AND m.user_id = lumbung.current_user_id()
         AND m.status = 'ACTIVE'
         AND p_cap = ANY (m.capabilities);
    ELSIF v_kind = 'FLO_LINK' THEN
      IF p_cap = ANY (lumbung.actor_kind_allowlist('FLO_LINK')) THEN
        SELECT true INTO v_ok
          FROM lumbung.flo_access_links l
         WHERE l.tenant_id = v_tenant
           AND l.id = lumbung.current_link_id()
           AND l.revoked_at IS NULL
           AND l.expires_at > lumbung.tenant_now_at(v_tenant)
           AND p_cap = ANY (l.actions);
        IF v_ok IS NULL THEN v_reason := 'LINK_INVALID_OR_OUT_OF_SCOPE'; END IF;
      END IF;
    ELSE
      v_ok := p_cap = ANY (lumbung.actor_kind_allowlist(v_kind));
      IF NOT v_ok THEN v_reason := 'NOT_ALLOWED_FOR_ACTOR_KIND'; END IF;
    END IF;

    IF v_ok IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:FORBIDDEN',
        DETAIL = json_build_object('capability', p_cap, 'actor_kind', v_kind, 'reason', v_reason)::text;
    END IF;
  END
  $$;

-- has_cap(cap): non-raising variant for UI "disabled reason" rendering.
CREATE FUNCTION lumbung.has_cap(p_cap text) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  BEGIN
    PERFORM lumbung.require_ctx();
    PERFORM lumbung.require_cap(p_cap);
    RETURN true;
  EXCEPTION WHEN raise_exception THEN
    RETURN false;
  END
  $$;
