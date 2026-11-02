-- 0012_rls_grants: row-level security on every tenant table, table grants
-- for lumbung_app, and function EXECUTE lockdown.
--
-- No FORCE RLS: the owner (and therefore SECURITY DEFINER functions)
-- bypasses RLS and must filter by current_tenant() explicitly.
-- Later stages: call lumbung.apply_tenant_rls('lumbung.<table>') for every new
-- tenant table, add explicit grants, and GRANT EXECUTE only on public commands.

SET LOCAL search_path = lumbung, pg_temp;

-- Owner-only helper: enable RLS + tenant isolation policy t_iso + SELECT for
-- the app role. Idempotent.
CREATE FUNCTION lumbung.apply_tenant_rls(p_table regclass, p_grant_select boolean DEFAULT true) RETURNS void
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  BEGIN
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = p_table AND p.polname = 't_iso') THEN
      EXECUTE format(
        'CREATE POLICY t_iso ON %s AS PERMISSIVE FOR ALL TO lumbung_app '
        'USING (tenant_id = (SELECT lumbung.current_tenant())) '
        'WITH CHECK (tenant_id = (SELECT lumbung.current_tenant()))', p_table);
    END IF;
    IF p_grant_select THEN
      EXECUTE format('GRANT SELECT ON %s TO lumbung_app', p_table);
    END IF;
  END
  $$;

GRANT USAGE ON SCHEMA lumbung TO lumbung_app;
REVOKE ALL ON ALL TABLES IN SCHEMA lumbung FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- RLS on every table that has a tenant_id column (catalog-driven, so no
-- table can be forgotten). Tables with special policies are handled below.
-- ---------------------------------------------------------------------------
DO $rls$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl, c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'lumbung' AND c.relkind IN ('r','p')
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
       AND c.relname NOT IN ('category_demands','need_assessments')
     ORDER BY c.relname
  LOOP
    PERFORM lumbung.apply_tenant_rls(r.tbl, r.relname NOT IN ('idempotency_keys','flo_access_links'));
  END LOOP;
END
$rls$;

-- category_demands / need_assessments: read in tenant; the app may only
-- INSERT proposals (status PROPOSED, unconfirmed). Confirmation is a command.
ALTER TABLE lumbung.category_demands ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_iso ON lumbung.category_demands AS PERMISSIVE FOR SELECT TO lumbung_app
  USING (tenant_id = (SELECT lumbung.current_tenant()));
CREATE POLICY t_iso_propose ON lumbung.category_demands AS PERMISSIVE FOR INSERT TO lumbung_app
  WITH CHECK (tenant_id = (SELECT lumbung.current_tenant()) AND status = 'PROPOSED' AND confirmed_by IS NULL);

ALTER TABLE lumbung.need_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_iso ON lumbung.need_assessments AS PERMISSIVE FOR SELECT TO lumbung_app
  USING (tenant_id = (SELECT lumbung.current_tenant()));
CREATE POLICY t_iso_propose ON lumbung.need_assessments AS PERMISSIVE FOR INSERT TO lumbung_app
  WITH CHECK (tenant_id = (SELECT lumbung.current_tenant()) AND status = 'PROPOSED' AND confirmed_by IS NULL);

-- tenants: only the current tenant row.
ALTER TABLE lumbung.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_iso ON lumbung.tenants AS PERMISSIVE FOR SELECT TO lumbung_app
  USING (id = (SELECT lumbung.current_tenant()));

-- users: only users with a membership in the current tenant.
ALTER TABLE lumbung.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_iso ON lumbung.users AS PERMISSIVE FOR SELECT TO lumbung_app
  USING (EXISTS (SELECT 1 FROM lumbung.memberships m
                  WHERE m.user_id = users.id AND m.tenant_id = (SELECT lumbung.current_tenant())));

-- worker_heartbeats is global operational metadata (no tenant data): RLS on,
-- read-only for the app. Writes go through a worker function (S2).
ALTER TABLE lumbung.worker_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_read ON lumbung.worker_heartbeats AS PERMISSIVE FOR SELECT TO lumbung_app USING (true);

-- ---------------------------------------------------------------------------
-- Table grants for lumbung_app.
-- SELECT on everything except idempotency_keys, flo_access_links,
-- schema_migrations (owner-only).
-- ---------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA lumbung TO lumbung_app;
REVOKE ALL ON lumbung.idempotency_keys, lumbung.flo_access_links, lumbung.schema_migrations FROM lumbung_app;

-- Narrow, RLS-checked INSERT/UPDATE (column lists where a table mixes
-- editable and protected columns). Nothing else is writable directly.

-- donation_orders: non-state columns (route and code are fixed at creation).
GRANT INSERT (id, tenant_id, code, donor_id, source_location_id, route, intake_channel, donation_reason,
              pickup_start, pickup_end, external_ref, created_by)
  ON lumbung.donation_orders TO lumbung_app;
GRANT UPDATE (donor_id, source_location_id, intake_channel, donation_reason, pickup_start, pickup_end,
              external_ref, updated_at)
  ON lumbung.donation_orders TO lumbung_app;

-- donation_items: non-state columns (no safety_state, no revision).
GRANT INSERT (id, tenant_id, order_id, line_no, product_id, category_id, description, quantity, unit, unit_kind,
              conversion_id, est_weight_kg, measured_weight_kg, weight_provenance, condition, storage_req,
              prep_info, label_info, distribute_by, parse, missing_fields, created_by)
  ON lumbung.donation_items TO lumbung_app;
GRANT UPDATE (product_id, category_id, description, quantity, unit, unit_kind, conversion_id, est_weight_kg,
              measured_weight_kg, weight_provenance, condition, storage_req, prep_info, label_info,
              distribute_by, parse, missing_fields, updated_at)
  ON lumbung.donation_items TO lumbung_app;

-- flos: profile columns only (no tenure, no revision; revision is bumped by trigger).
GRANT INSERT (id, tenant_id, code, name, flo_type, service_model, status, address, area, lat, lng,
              location_confidence, cooking_capable, storage_capabilities, halal_required, allergen_exclusions,
              created_by)
  ON lumbung.flos TO lumbung_app;
GRANT UPDATE (name, flo_type, service_model, status, address, area, lat, lng, location_confidence,
              cooking_capable, storage_capabilities, halal_required, allergen_exclusions, updated_at)
  ON lumbung.flos TO lumbung_app;

GRANT INSERT (id, tenant_id, flo_id, channel, address_ciphertext, address_hint, role, verification_state,
              consent_state, opted_out_at, contact_hours, created_by)
  ON lumbung.flo_contacts TO lumbung_app;
GRANT UPDATE (channel, address_ciphertext, address_hint, role, verification_state, consent_state,
              opted_out_at, contact_hours, updated_at)
  ON lumbung.flo_contacts TO lumbung_app;

GRANT INSERT (id, tenant_id, flo_id, cluster_id, is_primary, created_by) ON lumbung.flo_clusters TO lumbung_app;
GRANT UPDATE (is_primary, updated_at) ON lumbung.flo_clusters TO lumbung_app;

GRANT INSERT (id, tenant_id, flo_id, kind, dow, start_local, end_local, starts_at, ends_at, created_by)
  ON lumbung.availability_windows TO lumbung_app;
GRANT UPDATE (dow, start_local, end_local, starts_at, ends_at, updated_at)
  ON lumbung.availability_windows TO lumbung_app;

-- service_schedules: declared columns only (verified_* are confirmed by staff commands).
GRANT INSERT (id, tenant_id, flo_id, effective_from, effective_to_excl, service_dows, people_per_event,
              count_basis, declared_count, created_by)
  ON lumbung.service_schedules TO lumbung_app;
GRANT UPDATE (effective_to_excl, service_dows, people_per_event, count_basis, declared_count, updated_at)
  ON lumbung.service_schedules TO lumbung_app;

-- category_demands / need_assessments: INSERT proposals only (status and
-- confirmed_by are not insertable; the policy additionally checks PROPOSED).
GRANT INSERT (id, tenant_id, flo_id, category_id, unit, basis, quantity, valid_from, valid_to_excl, confidence,
              assessor_id, created_by)
  ON lumbung.category_demands TO lumbung_app;
GRANT INSERT (id, tenant_id, flo_id, category_id, score, basis, requested_qty, unit, intended_distribution_date,
              available_stock_qty, expected_deliveries_qty, existing_support, assessor_id, assessed_at,
              expires_at, created_by)
  ON lumbung.need_assessments TO lumbung_app;

-- media_files: insert metadata (duplicate flag / deletion state via functions).
GRANT INSERT (id, tenant_id, storage_key, sha256, mime, bytes, uploader_actor, uploaded_at, captured_at,
              sensitivity, purpose, retention_until, created_by)
  ON lumbung.media_files TO lumbung_app;

-- messages: insert only (approval of agent drafts via function).
GRANT INSERT (id, tenant_id, conversation_id, direction, provider, provider_message_id, reference_code, body,
              intent, parse, status, is_agent_draft, correlation_id, created_by)
  ON lumbung.messages TO lumbung_app;

GRANT INSERT (id, tenant_id, kind, subject_type, subject_id, severity, state, assignee_id, due_at, dedup_key,
              payload, created_by)
  ON lumbung.tasks TO lumbung_app;
GRANT UPDATE (severity, state, assignee_id, due_at, payload, resolved_at, resolution, updated_at)
  ON lumbung.tasks TO lumbung_app;

GRANT INSERT ON lumbung.allocation_runs TO lumbung_app;

-- AC20: expected inbound registration (state stays EXPECTED; receiving is a command).
GRANT INSERT (id, tenant_id, order_id, warehouse_id, expected_at, created_by)
  ON lumbung.expected_inbounds TO lumbung_app;
GRANT INSERT (id, tenant_id, inbound_id, item_id, product_id, expected_qty, unit, created_by)
  ON lumbung.inbound_lines TO lumbung_app;

GRANT INSERT (id, tenant_id, kind, file_sha256, source_revision, summary, created_by)
  ON lumbung.import_runs TO lumbung_app;
GRANT UPDATE (summary, updated_at) ON lumbung.import_runs TO lumbung_app;
GRANT INSERT (id, tenant_id, run_id, row_no, raw, parsed, errors, duplicate_of, action, created_by)
  ON lumbung.import_rows TO lumbung_app;
GRANT UPDATE (parsed, errors, duplicate_of, action, updated_at) ON lumbung.import_rows TO lumbung_app;

-- ---------------------------------------------------------------------------
-- Function EXECUTE lockdown: revoke from PUBLIC for every function in the
-- schema, then grant only the public helper set. Internal helpers
-- (verify_tenant_invariants, demo_reset_begin, apply_tenant_rls,
-- agreement_valid_at_for, trigger functions) stay owner-only.
-- ---------------------------------------------------------------------------
DO $fn$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'lumbung'
     ORDER BY 1
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END
$fn$;

GRANT EXECUTE ON FUNCTION
  lumbung.current_tenant(),
  lumbung.current_user_id(),
  lumbung.current_actor_kind(),
  lumbung.current_link_id(),
  lumbung.current_correlation_id(),
  lumbung.current_actor(),
  lumbung.canonical_hash(jsonb),
  lumbung.known_capabilities(),
  lumbung.actor_kind_allowlist(text),
  lumbung.tenant_now(),
  lumbung.tenant_now_at(uuid),
  lumbung.tenant_now_for(lumbung.tenant_clocks),
  lumbung.require_ctx(),
  lumbung.require_cap(text),
  lumbung.has_cap(text),
  lumbung.agreement_valid_at(uuid, timestamptz),
  lumbung.agreement_status(lumbung.agreements, timestamptz),
  lumbung.agreement_is_expiring_soon(lumbung.agreements, timestamptz, interval)
TO lumbung_app;

-- Composite types used in granted signatures.
GRANT USAGE ON TYPE lumbung.tenant_clocks, lumbung.agreements TO lumbung_app;

-- ---------------------------------------------------------------------------
-- Index every foreign key whose columns are not already a leading prefix of
-- an index (cascading tenant deletes and RI checks stay fast). Deterministic
-- names: <constraint>_fkx (truncated to 63 chars).
-- ---------------------------------------------------------------------------
DO $fkidx$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname, con.conrelid::regclass AS tbl,
           (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
     WHERE n.nspname = 'lumbung' AND con.contype = 'f'
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_index i
          WHERE i.indrelid = con.conrelid
            AND (i.indkey::int2[])[0:cardinality(con.conkey) - 1] = con.conkey)
     ORDER BY con.conrelid::regclass::text, con.conname
  LOOP
    EXECUTE format('CREATE INDEX %I ON %s (%s)', left(r.conname, 59) || '_fkx', r.tbl, r.cols);
  END LOOP;
END
$fkidx$;
