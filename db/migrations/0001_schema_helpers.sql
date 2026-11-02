-- 0001_schema_helpers: schema, context helpers, canonical hashing.
-- Conventions: docs/architecture.md A.0. Everything lives in schema `lumbung`.
-- No extensions (gen_random_uuid / sha256 are core since PG13).

SET LOCAL search_path = lumbung, pg_temp;

CREATE SCHEMA IF NOT EXISTS lumbung;

-- Functions created by the owner must never be executable by PUBLIC by
-- default. (Must be global, not IN SCHEMA: per-schema defaults can only add.)
ALTER DEFAULT PRIVILEGES FOR ROLE lumbung_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE lumbung_owner REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE lumbung_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE lumbung_owner REVOKE USAGE ON TYPES FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Context GUCs (docs/architecture.md G.2). Set per transaction by withTx via
-- set_config(..., true). They are NOT trusted for authorisation on their own:
-- require_cap() looks capabilities up in memberships / flo_access_links /
-- a fixed WORKER/AGENT allowlist. Limitation: anyone holding the app
-- credential can forge app.user_id (no per-user DB roles); see db/README.md.
-- ---------------------------------------------------------------------------

CREATE FUNCTION lumbung.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION lumbung.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION lumbung.current_actor_kind() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.actor_kind', true), '') $$;

CREATE FUNCTION lumbung.current_link_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.link_id', true), '')::uuid $$;

CREATE FUNCTION lumbung.current_correlation_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.correlation_id', true), '') $$;

-- The whole context as one jsonb (convenient for audit payloads).
CREATE FUNCTION lumbung.current_actor() RETURNS jsonb
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT jsonb_build_object(
      'tenant_id', lumbung.current_tenant(),
      'user_id', lumbung.current_user_id(),
      'actor_kind', lumbung.current_actor_kind(),
      'link_id', lumbung.current_link_id(),
      'correlation_id', lumbung.current_correlation_id())
  $$;

-- ---------------------------------------------------------------------------
-- Canonical hashing. jsonb text output has a deterministic key order
-- (shorter keys first, then bytewise), so this is the single hash
-- implementation; TypeScript reads results back rather than re-implementing.
-- ---------------------------------------------------------------------------
CREATE FUNCTION lumbung.canonical_hash(j jsonb) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT encode(sha256(convert_to(j::text, 'UTF8')), 'hex') $$;

-- ---------------------------------------------------------------------------
-- Capability vocabulary (docs/architecture.md G.3). Single SQL source; must
-- equal src/shared/capabilities.ts. Replace via a later migration when
-- capabilities are added.
-- ---------------------------------------------------------------------------
CREATE FUNCTION lumbung.known_capabilities() RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT ARRAY[
    'flo.read','flo.edit','need.propose','need.confirm','agreement.upload','agreement.review',
    'donation.create','donation.validate','allocation.run','outreach.approve','campaign.start','offer.respond',
    'transport.edit','dispatch.approve','delivery.dispatch','delivery.receive','reservation.release',
    'receipt.correct','receipt.correct.approve',
    'inventory.receive','inventory.inspect','inventory.quarantine_release','inventory.pick',
    'inventory.adjust.request','inventory.adjust.approve','inventory.recall',
    'evidence.submit','evidence.review','evidence.excuse','conversation.takeover','message.send',
    'import.preview','import.commit','policy.manage','users.manage','audit.read','media.sensitive.read',
    'demo.clock','demo.reset'
  ]::text[] $$;

-- Fixed allowlists for non-human actor kinds (G.3). WORKER/AGENT never get
-- agreement.review, outreach.approve, dispatch.approve,
-- inventory.quarantine_release, need.confirm, policy.manage, evidence.excuse.
-- FLO_LINK is additionally limited to the actions stored on its link row.
CREATE FUNCTION lumbung.actor_kind_allowlist(p_kind text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT CASE p_kind
      WHEN 'WORKER' THEN ARRAY[
        'flo.read','need.propose','donation.create','donation.validate','allocation.run',
        'campaign.start','offer.respond','transport.edit','delivery.receive','reservation.release',
        'evidence.submit','message.send','audit.read']::text[]
      WHEN 'AGENT' THEN ARRAY[
        'flo.read','need.propose','donation.create','donation.validate','allocation.run',
        'offer.respond','transport.edit','evidence.submit','message.send']::text[]
      WHEN 'FLO_LINK' THEN ARRAY[
        'offer.respond','transport.edit','delivery.receive','evidence.submit']::text[]
      WHEN 'SYSTEM' THEN ARRAY['flo.read']::text[]
      ELSE ARRAY[]::text[]
    END
  $$;

-- ---------------------------------------------------------------------------
-- Append-only guard for audit_events / domain_events / the stock ledger.
-- UPDATE/DELETE is refused for everyone (including the owner). The only
-- escape hatch: DELETE while the transaction-local setting
-- `lumbung.reset_tenant` equals the row's tenant (set only by the owner-only
-- demo_reset_begin, whose tenant cascade deletes the rows). UPDATE and
-- TRUNCATE are always refused.
-- ---------------------------------------------------------------------------
CREATE FUNCTION lumbung.tg_append_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'TRUNCATE' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:APPEND_ONLY',
        DETAIL = json_build_object('table', TG_TABLE_NAME, 'op', TG_OP)::text;
    END IF;
    IF TG_OP = 'DELETE'
       AND coalesce(current_setting('lumbung.reset_tenant', true), '') = OLD.tenant_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:APPEND_ONLY',
      DETAIL = json_build_object('table', TG_TABLE_NAME, 'op', TG_OP)::text;
  END
  $$;
