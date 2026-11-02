-- 0013_agreement_commands (W2-FLO, Stage 1): the first command functions, following
-- the architecture A.2 framework, plus the shared internal helpers they use.
--
--   Commands (SECURITY DEFINER, search_path pinned, require_ctx + require_cap,
--   explicit tenant filter, idempotency, expected_revision, audit + domain event;
--   EXECUTE granted to lumbung_app):
--     create_flo(p_payload, ...)                               flo.edit
--     update_flo_profile(p_flo, p_expected_rev, p_patch, ...)  flo.edit
--     upload_agreement(p_flo, p_media, p_signed, p_from, p_through, ...)   agreement.upload
--     approve_agreement(p_id, p_expected_rev, p_overlap_resolution, ...)   agreement.review
--     revoke_agreement(p_id, p_expected_rev, p_reason, ...)                agreement.review
--     propose_need(p_flo, p_category, p_score, ..., p_valid_days, ...)     need.propose
--     confirm_need(p_need, ...)                                            need.confirm
--   Every command ends with (p_idem_key text, p_request_hash text) and returns jsonb.
--   A NULL p_idem_key disables replay protection (the HTTP layer always sends one).
--
--   Internal helpers (owner-only, SECURITY INVOKER; they run as the owner because
--   they are only ever called from inside SECURITY DEFINER commands). Later stages
--   reuse them instead of redefining them:
--     lb_raise(code, detail)                 RAISE 'LB:<code>' with a JSON DETAIL
--     idem_begin(key, command, hash)         NULL = first execution; otherwise the
--                                            stored response (same hash) or
--                                            LB:IDEMPOTENCY_PAYLOAD_MISMATCH
--     idem_complete(key, response)           store the response for replays
--     append_audit(...)                      audit_events row (actor/correlation/clock
--                                            from the context GUCs and tenant_now())
--     emit_event(...)                        domain_events row
--     agreement_json(a, t)                   API shape of one agreement at instant t
--     on_agreement_revoked(agreement, flo, reason)
--                                            S2 HOOK. Stage 1 is a no-op that reports
--                                            zero affected commitments. Stage 2 replaces
--                                            it (CREATE OR REPLACE, same signature) to
--                                            invalidate approvals, move OFFER_HELD..APPROVED
--                                            allocations to EXCEPTION, cancel
--                                            pre-acceptance offers / release holds and
--                                            open AGREEMENT_REVOKED_ACTIVE_COMMITMENT tasks.
--
-- Clock: every instant written here comes from lumbung.tenant_now(); no command
-- accepts a caller "now".

SET LOCAL search_path = lumbung, pg_temp;

-- ---------------------------------------------------------------------------
-- Fix: agreement_valid_at(uuid, timestamptz) is granted to lumbung_app (0012) but
-- 0005 implemented it by calling the owner-only agreement_valid_at_for(), so every
-- app-role call failed with 42501. Same signature and semantics, inlined (SECURITY
-- INVOKER: as the app role RLS applies in addition to the explicit tenant filter).
-- CREATE OR REPLACE keeps the existing EXECUTE grant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lumbung.agreement_valid_at(p_flo uuid, p_t timestamptz) RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT a.id
      FROM lumbung.agreements a
     WHERE a.tenant_id = lumbung.current_tenant()
       AND a.flo_id = p_flo
       AND a.review_state = 'APPROVED'
       AND a.valid_from <= p_t
       AND p_t < a.valid_until_exclusive
     ORDER BY a.valid_from DESC, a.id
     LIMIT 1
  $$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

CREATE FUNCTION lumbung.lb_raise(p_code text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LB:' || p_code,
      DETAIL = coalesce(p_detail, '{}'::jsonb)::text;
  END
  $$;

CREATE FUNCTION lumbung.idem_begin(p_key text, p_command text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := lumbung.current_tenant();
    v_row    lumbung.idempotency_keys;
    v_n      integer;
  BEGIN
    IF p_key IS NULL THEN
      RETURN NULL;
    END IF;
    IF v_tenant IS NULL THEN
      PERFORM lumbung.lb_raise('CONTEXT_REQUIRED', '{"reason":"NO_TENANT"}');
    END IF;
    IF p_request_hash IS NULL OR length(p_request_hash) = 0 THEN
      PERFORM lumbung.lb_raise('BAD_REQUEST', jsonb_build_object(
        'message', 'request_hash is required with an idempotency key', 'http', 400));
    END IF;
    -- A concurrent duplicate blocks on the primary key until the first
    -- transaction commits (then sees its row) or rolls back (then inserts).
    INSERT INTO lumbung.idempotency_keys (tenant_id, key, command, request_hash, actor_id, status, expires_at)
    VALUES (v_tenant, p_key, p_command, p_request_hash, lumbung.current_user_id(), 'IN_PROGRESS',
            now() + interval '7 days')
    ON CONFLICT (tenant_id, key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN
      RETURN NULL;
    END IF;

    SELECT * INTO v_row FROM lumbung.idempotency_keys k WHERE k.tenant_id = v_tenant AND k.key = p_key;
    IF v_row.command <> p_command OR v_row.request_hash <> p_request_hash THEN
      PERFORM lumbung.lb_raise('IDEMPOTENCY_PAYLOAD_MISMATCH', jsonb_build_object(
        'message', 'This Idempotency-Key was already used with a different request'));
    END IF;
    IF v_row.status <> 'COMPLETED' THEN
      PERFORM lumbung.lb_raise('IDEMPOTENCY_IN_PROGRESS', jsonb_build_object(
        'message', 'The original request is still in progress', 'retryable', true));
    END IF;
    RETURN v_row.response;
  END
  $$;

CREATE FUNCTION lumbung.idem_complete(p_key text, p_response jsonb, p_http_status integer DEFAULT 200) RETURNS void
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  BEGIN
    IF p_key IS NULL THEN
      RETURN;
    END IF;
    UPDATE lumbung.idempotency_keys k
       SET status = 'COMPLETED', response = p_response, http_status = p_http_status
     WHERE k.tenant_id = lumbung.current_tenant() AND k.key = p_key;
  END
  $$;

CREATE FUNCTION lumbung.append_audit(
    p_action text, p_subject_type text, p_subject_id uuid, p_subject_revision integer,
    p_reason text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb,
    p_before jsonb DEFAULT NULL, p_after jsonb DEFAULT NULL,
    p_policy_version_id uuid DEFAULT NULL) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    INSERT INTO lumbung.audit_events (
      tenant_id, actor_id, actor_kind, action, subject_type, subject_id, subject_revision,
      policy_version_id, reason, before_hash, after_hash, correlation_id, occurred_at, payload, created_by)
    VALUES (
      lumbung.current_tenant(), lumbung.current_user_id(), coalesce(lumbung.current_actor_kind(), 'SYSTEM'),
      p_action, p_subject_type, p_subject_id, p_subject_revision,
      p_policy_version_id, p_reason,
      CASE WHEN p_before IS NULL THEN NULL ELSE lumbung.canonical_hash(p_before) END,
      CASE WHEN p_after IS NULL THEN NULL ELSE lumbung.canonical_hash(p_after) END,
      lumbung.current_correlation_id(), lumbung.tenant_now(),
      coalesce(p_payload, '{}'::jsonb)
        || CASE WHEN lumbung.current_link_id() IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('link_id', lumbung.current_link_id()) END,
      lumbung.current_user_id())
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

CREATE FUNCTION lumbung.emit_event(
    p_type text, p_object_type text, p_object_id uuid, p_object_revision integer,
    p_payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    INSERT INTO lumbung.domain_events (
      tenant_id, type, object_type, object_id, object_revision, occurred_at, correlation_id, payload, created_by)
    VALUES (
      lumbung.current_tenant(), p_type, p_object_type, p_object_id, p_object_revision, lumbung.tenant_now(),
      lumbung.current_correlation_id(), coalesce(p_payload, '{}'::jsonb), lumbung.current_user_id())
    RETURNING id INTO v_id;
    RETURN v_id;
  END
  $$;

-- API shape of an agreement at instant t (status derived, never stored).
CREATE FUNCTION lumbung.agreement_json(a lumbung.agreements, t timestamptz) RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = lumbung, pg_temp
  AS $$
    SELECT jsonb_build_object(
      'id', a.id,
      'flo_id', a.flo_id,
      'version', a.version,
      'review_state', a.review_state,
      'status', lumbung.agreement_status(a, t),
      'expiring_soon', lumbung.agreement_is_expiring_soon(a, t),
      'document_media_id', a.document_media_id,
      'signed_date', a.signed_date,
      'valid_from_date', a.valid_from_date,
      'valid_through_date', a.valid_through_date,
      'valid_from', a.valid_from,
      'valid_until_exclusive', a.valid_until_exclusive,
      'uploaded_by', a.uploaded_by,
      'reviewer_id', a.reviewer_id,
      'reviewed_at', a.reviewed_at,
      'revoked_at', a.revoked_at,
      'revoke_reason', a.revoke_reason,
      'supersedes_id', a.supersedes_id,
      'revision', a.revision)
  $$;

-- S2 HOOK (see header). Stage 1: no commitments exist yet, nothing to invalidate.
CREATE FUNCTION lumbung.on_agreement_revoked(p_agreement uuid, p_flo uuid, p_reason text) RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  BEGIN
    RETURN jsonb_build_object(
      'hook', 'S1_NOOP',
      'invalidated_approvals', 0,
      'exception_allocations', 0,
      'cancelled_offers', 0,
      'tasks', 0);
  END
  $$;

-- ---------------------------------------------------------------------------
-- FLO profile commands (audited path for the profile columns)
-- ---------------------------------------------------------------------------

-- Draft FLO creation: no implicit verification. tenure NEW, location UNVERIFIED
-- unless stated, status PAUSED unless stated. Code FLO-NNNN is generated when not
-- supplied (serialised per tenant with an advisory lock).
CREATE FUNCTION lumbung.create_flo(p_payload jsonb, p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant  uuid := lumbung.require_ctx();
    v_prior   jsonb;
    v_code    text := nullif(btrim(p_payload->>'code'), '');
    v_cluster uuid := nullif(p_payload->>'cluster_id', '')::uuid;
    v_flo     lumbung.flos;
    v_res     jsonb;
    v_next    integer;
  BEGIN
    PERFORM lumbung.require_cap('flo.edit');
    v_prior := lumbung.idem_begin(p_idem_key, 'create_flo', p_request_hash);
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;

    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', '{"message":"payload must be an object","http":400}');
    END IF;
    IF v_cluster IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM lumbung.clusters c WHERE c.tenant_id = v_tenant AND c.id = v_cluster) THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object(
        'message', 'Unknown cluster', 'http', 400, 'field_errors', jsonb_build_object('cluster_id', jsonb_build_array('Unknown cluster'))));
    END IF;

    IF v_code IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('lumbung:flo-code:' || v_tenant::text, 0));
      SELECT coalesce(max((substring(f.code FROM '^FLO-([0-9]+)$'))::int), 0) + 1 INTO v_next
        FROM lumbung.flos f WHERE f.tenant_id = v_tenant;
      v_code := 'FLO-' || lpad(v_next::text, 4, '0');
    ELSIF EXISTS (SELECT 1 FROM lumbung.flos f WHERE f.tenant_id = v_tenant AND f.code = v_code) THEN
      PERFORM lumbung.lb_raise('CONFLICT', jsonb_build_object(
        'message', 'FLO code already exists', 'field_errors', jsonb_build_object('code', jsonb_build_array('Already exists'))));
    END IF;

    INSERT INTO lumbung.flos (
      tenant_id, code, name, flo_type, service_model, status, address, area, lat, lng, location_confidence,
      cooking_capable, storage_capabilities, halal_required, allergen_exclusions, tenure, created_by)
    VALUES (
      v_tenant, v_code, btrim(p_payload->>'name'), p_payload->>'flo_type', p_payload->>'service_model',
      coalesce(p_payload->>'status', 'PAUSED'), nullif(btrim(p_payload->>'address'), ''), p_payload->>'area',
      (p_payload->>'lat')::numeric, (p_payload->>'lng')::numeric,
      coalesce(p_payload->>'location_confidence', 'UNVERIFIED'),
      coalesce((p_payload->>'cooking_capable')::boolean, false),
      coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'storage_capabilities') x), '{AMBIENT}'),
      coalesce((p_payload->>'halal_required')::boolean, false),
      coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'allergen_exclusions') x), '{}'),
      'NEW', lumbung.current_user_id())
    RETURNING * INTO v_flo;

    IF v_cluster IS NOT NULL THEN
      INSERT INTO lumbung.flo_clusters (tenant_id, flo_id, cluster_id, is_primary, created_by)
      VALUES (v_tenant, v_flo.id, v_cluster, true, lumbung.current_user_id());
    END IF;

    v_res := jsonb_build_object('flo_id', v_flo.id, 'code', v_flo.code, 'status', v_flo.status,
                                'tenure', v_flo.tenure, 'revision', v_flo.revision);
    PERFORM lumbung.append_audit('FLO_CREATED', 'FLO', v_flo.id, v_flo.revision, NULL,
      jsonb_build_object('code', v_flo.code, 'cluster_id', v_cluster), NULL, to_jsonb(v_flo));
    PERFORM lumbung.emit_event('FloCreated', 'FLO', v_flo.id, v_flo.revision, v_res);
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

-- Revision-guarded profile edit. Only the keys present in p_patch change.
-- Changing coordinates without stating a confidence resets it to UNVERIFIED.
CREATE FUNCTION lumbung.update_flo_profile(p_flo uuid, p_expected_rev integer, p_patch jsonb,
    p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant  uuid := lumbung.require_ctx();
    v_prior   jsonb;
    v_before  lumbung.flos;
    v_after   lumbung.flos;
    v_changed text[];
    v_res     jsonb;
    v_allowed text[] := ARRAY['name','flo_type','service_model','status','address','area','lat','lng',
                              'location_confidence','cooking_capable','storage_capabilities','halal_required',
                              'allergen_exclusions'];
    v_bad     text[];
  BEGIN
    PERFORM lumbung.require_cap('flo.edit');
    v_prior := lumbung.idem_begin(p_idem_key, 'update_flo_profile', p_request_hash);
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;

    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', '{"message":"patch must be an object","http":400}');
    END IF;
    SELECT array_agg(k) INTO v_bad FROM jsonb_object_keys(p_patch) k WHERE NOT (k = ANY (v_allowed));
    IF v_bad IS NOT NULL THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object(
        'message', 'Field(s) not editable here', 'http', 400, 'fields', to_jsonb(v_bad)));
    END IF;

    SELECT * INTO v_before FROM lumbung.flos f WHERE f.tenant_id = v_tenant AND f.id = p_flo FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM lumbung.lb_raise('NOT_FOUND', '{"message":"FLO not found"}');
    END IF;
    IF p_expected_rev IS NULL OR v_before.revision <> p_expected_rev THEN
      PERFORM lumbung.lb_raise('REVISION_CONFLICT', jsonb_build_object(
        'message', 'The FLO was changed by someone else; reload and try again',
        'current_revision', v_before.revision));
    END IF;

    UPDATE lumbung.flos f SET
      name = CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE f.name END,
      flo_type = CASE WHEN p_patch ? 'flo_type' THEN p_patch->>'flo_type' ELSE f.flo_type END,
      service_model = CASE WHEN p_patch ? 'service_model' THEN p_patch->>'service_model' ELSE f.service_model END,
      status = CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE f.status END,
      address = CASE WHEN p_patch ? 'address' THEN nullif(btrim(p_patch->>'address'), '') ELSE f.address END,
      area = CASE WHEN p_patch ? 'area' THEN p_patch->>'area' ELSE f.area END,
      lat = CASE WHEN p_patch ? 'lat' THEN (p_patch->>'lat')::numeric ELSE f.lat END,
      lng = CASE WHEN p_patch ? 'lng' THEN (p_patch->>'lng')::numeric ELSE f.lng END,
      location_confidence = CASE
        WHEN p_patch ? 'location_confidence' THEN p_patch->>'location_confidence'
        WHEN (p_patch ? 'lat' AND (p_patch->>'lat')::numeric IS DISTINCT FROM f.lat)
          OR (p_patch ? 'lng' AND (p_patch->>'lng')::numeric IS DISTINCT FROM f.lng) THEN 'UNVERIFIED'
        ELSE f.location_confidence END,
      cooking_capable = CASE WHEN p_patch ? 'cooking_capable' THEN (p_patch->>'cooking_capable')::boolean ELSE f.cooking_capable END,
      storage_capabilities = CASE WHEN p_patch ? 'storage_capabilities'
        THEN coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(p_patch->'storage_capabilities') x), '{}')
        ELSE f.storage_capabilities END,
      halal_required = CASE WHEN p_patch ? 'halal_required' THEN (p_patch->>'halal_required')::boolean ELSE f.halal_required END,
      allergen_exclusions = CASE WHEN p_patch ? 'allergen_exclusions'
        THEN coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(p_patch->'allergen_exclusions') x), '{}')
        ELSE f.allergen_exclusions END
     WHERE f.tenant_id = v_tenant AND f.id = p_flo
    RETURNING * INTO v_after;

    SELECT array_agg(b.key ORDER BY b.key) INTO v_changed
      FROM jsonb_each(to_jsonb(v_before)) b
      JOIN jsonb_each(to_jsonb(v_after)) a USING (key)
     WHERE b.key = ANY (v_allowed) AND a.value IS DISTINCT FROM b.value;

    v_res := jsonb_build_object('flo_id', v_after.id, 'revision', v_after.revision,
                                'changed', coalesce(to_jsonb(v_changed), '[]'::jsonb));
    IF v_changed IS NOT NULL THEN
      PERFORM lumbung.append_audit('FLO_PROFILE_UPDATED', 'FLO', v_after.id, v_after.revision, NULL,
        jsonb_build_object('changed', to_jsonb(v_changed), 'from_revision', v_before.revision),
        to_jsonb(v_before), to_jsonb(v_after));
      PERFORM lumbung.emit_event('FloProfileUpdated', 'FLO', v_after.id, v_after.revision, v_res);
    END IF;
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

-- ---------------------------------------------------------------------------
-- Agreement commands (PRD §5)
-- ---------------------------------------------------------------------------

-- Upload (metadata + legal dates). Never overwrites: a new version row in
-- PENDING_VERIFICATION. Instants = local legal dates in the tenant time zone:
-- valid_from = from 00:00, valid_until_exclusive = (through + 1) 00:00.
-- A pending renewal is not valid anywhere (agreement_valid_at only sees APPROVED).
CREATE FUNCTION lumbung.upload_agreement(p_flo uuid, p_media uuid, p_signed date, p_from date, p_through date,
    p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant  uuid := lumbung.require_ctx();
    v_prior   jsonb;
    v_tz      text;
    v_version integer;
    v_a       lumbung.agreements;
    v_linked  integer;
    v_res     jsonb;
  BEGIN
    PERFORM lumbung.require_cap('agreement.upload');
    v_prior := lumbung.idem_begin(p_idem_key, 'upload_agreement', p_request_hash);
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;

    IF p_from IS NULL OR p_through IS NULL THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'Legal dates are required', 'http', 400,
        'field_errors', jsonb_build_object('valid_from_date', jsonb_build_array('Required'),
                                           'valid_through_date', jsonb_build_array('Required'))));
    END IF;
    IF p_through < p_from THEN
      PERFORM lumbung.lb_raise('AGREEMENT_INVALID_INTERVAL', jsonb_build_object(
        'message', 'valid_through_date must not be before valid_from_date',
        'field_errors', jsonb_build_object('valid_through_date', jsonb_build_array('Must be on or after the start date'))));
    END IF;
    IF p_signed IS NOT NULL AND p_signed > p_through THEN
      PERFORM lumbung.lb_raise('AGREEMENT_INVALID_INTERVAL', jsonb_build_object(
        'message', 'signed_date must not be after valid_through_date',
        'field_errors', jsonb_build_object('signed_date', jsonb_build_array('Must not be after the end date'))));
    END IF;

    -- Serialise version numbering per FLO.
    PERFORM 1 FROM lumbung.flos f WHERE f.tenant_id = v_tenant AND f.id = p_flo FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM lumbung.lb_raise('NOT_FOUND', '{"message":"FLO not found"}');
    END IF;
    IF p_media IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM lumbung.media_files m
          WHERE m.tenant_id = v_tenant AND m.id = p_media AND m.deletion_state = 'ACTIVE') THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'Unknown document', 'http', 400,
        'field_errors', jsonb_build_object('document_media_id', jsonb_build_array('Unknown document'))));
    END IF;

    SELECT t.timezone INTO v_tz FROM lumbung.tenants t WHERE t.id = v_tenant;
    SELECT coalesce(max(a.version), 0) + 1 INTO v_version
      FROM lumbung.agreements a WHERE a.tenant_id = v_tenant AND a.flo_id = p_flo;

    INSERT INTO lumbung.agreements (
      tenant_id, flo_id, document_media_id, version, signed_date, valid_from_date, valid_through_date,
      valid_from, valid_until_exclusive, review_state, uploaded_by, created_by)
    VALUES (
      v_tenant, p_flo, p_media, v_version, p_signed, p_from, p_through,
      p_from::timestamp AT TIME ZONE v_tz, (p_through + 1)::timestamp AT TIME ZONE v_tz,
      'PENDING_VERIFICATION', lumbung.current_user_id(), lumbung.current_user_id())
    RETURNING * INTO v_a;

    -- Open renewal tasks of this FLO now point at the submitted renewal; they
    -- stay OPEN until a reviewer approves it.
    UPDATE lumbung.renewal_tasks rt
       SET submitted_agreement_id = v_a.id, updated_at = now()
      FROM lumbung.agreements prev
     WHERE rt.tenant_id = v_tenant AND prev.tenant_id = v_tenant
       AND prev.id = rt.agreement_id AND prev.flo_id = p_flo
       AND rt.status = 'OPEN' AND rt.submitted_agreement_id IS NULL;
    GET DIAGNOSTICS v_linked = ROW_COUNT;

    v_res := jsonb_build_object('agreement', lumbung.agreement_json(v_a, lumbung.tenant_now()),
                                'linked_renewal_tasks', v_linked);
    PERFORM lumbung.append_audit('AGREEMENT_UPLOADED', 'AGREEMENT', v_a.id, v_a.revision, NULL,
      jsonb_build_object('flo_id', p_flo, 'version', v_a.version, 'signed_date', p_signed,
                         'valid_from_date', p_from, 'valid_through_date', p_through,
                         'document_media_id', p_media, 'timezone', v_tz),
      NULL, to_jsonb(v_a));
    PERFORM lumbung.emit_event('AgreementUploaded', 'AGREEMENT', v_a.id, v_a.revision,
      jsonb_build_object('flo_id', p_flo, 'version', v_a.version));
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

-- Reviewer approval. Overlap with another APPROVED interval of the same FLO
-- requires an explicit resolution (only SUPERSEDE_PREVIOUS: the overlapping
-- approved versions become SUPERSEDED). Creates renewal tasks 30/14/7 days
-- before the exclusive end (deduplicated) and closes the predecessors' open
-- renewal tasks.
CREATE FUNCTION lumbung.approve_agreement(p_id uuid, p_expected_rev integer, p_overlap_resolution text,
    p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant     uuid := lumbung.require_ctx();
    v_prior      jsonb;
    v_a          lumbung.agreements;
    v_now        timestamptz;
    v_overlap    uuid[];
    v_sup        lumbung.agreements;
    v_superseded jsonb := '[]'::jsonb;
    v_tasks      integer;
    v_closed     integer;
    v_res        jsonb;
  BEGIN
    PERFORM lumbung.require_cap('agreement.review');
    v_prior := lumbung.idem_begin(p_idem_key, 'approve_agreement', p_request_hash);
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
    IF p_overlap_resolution IS NOT NULL AND p_overlap_resolution <> 'SUPERSEDE_PREVIOUS' THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'Unknown overlap resolution', 'http', 400,
        'field_errors', jsonb_build_object('overlap_resolution', jsonb_build_array('Allowed: SUPERSEDE_PREVIOUS'))));
    END IF;

    SELECT * INTO v_a FROM lumbung.agreements a WHERE a.tenant_id = v_tenant AND a.id = p_id;
    IF NOT FOUND THEN
      PERFORM lumbung.lb_raise('NOT_FOUND', '{"message":"Agreement not found"}');
    END IF;
    -- Lock every version of this FLO in id order: concurrent reviews of one FLO
    -- serialise, so two overlapping approvals can never both succeed.
    PERFORM 1 FROM lumbung.agreements a
      WHERE a.tenant_id = v_tenant AND a.flo_id = v_a.flo_id ORDER BY a.id FOR UPDATE;
    SELECT * INTO v_a FROM lumbung.agreements a WHERE a.tenant_id = v_tenant AND a.id = p_id;

    IF p_expected_rev IS NULL OR v_a.revision <> p_expected_rev THEN
      PERFORM lumbung.lb_raise('REVISION_CONFLICT', jsonb_build_object(
        'message', 'The agreement was changed by someone else; reload and try again',
        'current_revision', v_a.revision));
    END IF;
    IF v_a.review_state <> 'PENDING_VERIFICATION' THEN
      PERFORM lumbung.lb_raise('INVALID_STATE', jsonb_build_object(
        'message', 'Only an agreement pending verification can be approved', 'review_state', v_a.review_state));
    END IF;

    v_now := lumbung.tenant_now();

    SELECT array_agg(o.id ORDER BY o.valid_from, o.id) INTO v_overlap
      FROM lumbung.agreements o
     WHERE o.tenant_id = v_tenant AND o.flo_id = v_a.flo_id AND o.id <> v_a.id
       AND o.review_state = 'APPROVED'
       AND o.valid_from < v_a.valid_until_exclusive AND v_a.valid_from < o.valid_until_exclusive;

    IF v_overlap IS NOT NULL THEN
      IF p_overlap_resolution IS NULL THEN
        PERFORM lumbung.lb_raise('AGREEMENT_OVERLAP_UNRESOLVED', jsonb_build_object(
          'message', 'The interval overlaps an approved agreement; choose an explicit resolution',
          'overlapping_agreement_ids', to_jsonb(v_overlap),
          'allowed_resolutions', jsonb_build_array('SUPERSEDE_PREVIOUS')));
      END IF;
      FOR v_sup IN
        UPDATE lumbung.agreements a
           SET review_state = 'SUPERSEDED', revision = a.revision + 1, updated_at = now()
         WHERE a.tenant_id = v_tenant AND a.id = ANY (v_overlap)
        RETURNING a.*
      LOOP
        v_superseded := v_superseded || to_jsonb(v_sup.id);
        UPDATE lumbung.renewal_tasks rt
           SET status = 'CANCELLED', submitted_agreement_id = v_a.id, updated_at = now()
         WHERE rt.tenant_id = v_tenant AND rt.agreement_id = v_sup.id AND rt.status = 'OPEN';
        PERFORM lumbung.append_audit('AGREEMENT_SUPERSEDED', 'AGREEMENT', v_sup.id, v_sup.revision, NULL,
          jsonb_build_object('flo_id', v_sup.flo_id, 'superseded_by', v_a.id, 'resolution', p_overlap_resolution));
      END LOOP;
    END IF;

    UPDATE lumbung.agreements a
       SET review_state = 'APPROVED',
           reviewer_id = lumbung.current_user_id(),
           reviewed_at = v_now,
           supersedes_id = CASE WHEN v_overlap IS NULL THEN a.supersedes_id
                                ELSE v_overlap[array_length(v_overlap, 1)] END,
           revision = a.revision + 1,
           updated_at = now()
     WHERE a.tenant_id = v_tenant AND a.id = p_id
    RETURNING * INTO v_a;

    INSERT INTO lumbung.renewal_tasks (tenant_id, agreement_id, offset_days, due_at, status, created_by)
    SELECT v_tenant, v_a.id, o, v_a.valid_until_exclusive - make_interval(days => o), 'OPEN', lumbung.current_user_id()
      FROM unnest(ARRAY[30, 14, 7]) AS o
     WHERE v_a.valid_until_exclusive - make_interval(days => o) > v_a.valid_from
    ON CONFLICT (tenant_id, agreement_id, offset_days) DO NOTHING;
    GET DIAGNOSTICS v_tasks = ROW_COUNT;

    -- Predecessors renewed by this approval: their open renewal tasks are done.
    UPDATE lumbung.renewal_tasks rt
       SET status = 'DONE', submitted_agreement_id = v_a.id, updated_at = now()
      FROM lumbung.agreements prev
     WHERE rt.tenant_id = v_tenant AND prev.tenant_id = v_tenant
       AND prev.id = rt.agreement_id AND prev.flo_id = v_a.flo_id AND prev.id <> v_a.id
       AND prev.valid_until_exclusive <= v_a.valid_until_exclusive
       AND rt.status = 'OPEN';
    GET DIAGNOSTICS v_closed = ROW_COUNT;

    v_res := jsonb_build_object(
      'agreement', lumbung.agreement_json(v_a, v_now),
      'overlap_resolution', p_overlap_resolution,
      'superseded_agreement_ids', v_superseded,
      'renewal_tasks_created', v_tasks,
      'renewal_tasks_closed', v_closed);
    PERFORM lumbung.append_audit('AGREEMENT_APPROVED', 'AGREEMENT', v_a.id, v_a.revision, NULL,
      jsonb_build_object('flo_id', v_a.flo_id, 'valid_from_date', v_a.valid_from_date,
                         'valid_through_date', v_a.valid_through_date,
                         'valid_until_exclusive', v_a.valid_until_exclusive,
                         'overlap_resolution', p_overlap_resolution, 'superseded_agreement_ids', v_superseded),
      NULL, to_jsonb(v_a));
    PERFORM lumbung.emit_event('AgreementApproved', 'AGREEMENT', v_a.id, v_a.revision,
      jsonb_build_object('flo_id', v_a.flo_id, 'superseded_agreement_ids', v_superseded));
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

-- Reviewer revocation (Stage 1): REVOKED + audit + staff task; open renewal
-- tasks of the revoked version are cancelled. Commitment invalidation is the
-- on_agreement_revoked() hook, extended in Stage 2.
CREATE FUNCTION lumbung.revoke_agreement(p_id uuid, p_expected_rev integer, p_reason text,
    p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant  uuid := lumbung.require_ctx();
    v_prior   jsonb;
    v_reason  text := btrim(coalesce(p_reason, ''));
    v_a       lumbung.agreements;
    v_now     timestamptz;
    v_code    text;
    v_hook    jsonb;
    v_task    uuid;
    v_res     jsonb;
  BEGIN
    PERFORM lumbung.require_cap('agreement.review');
    v_prior := lumbung.idem_begin(p_idem_key, 'revoke_agreement', p_request_hash);
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
    IF length(v_reason) < 3 THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'A reason is required', 'http', 400,
        'field_errors', jsonb_build_object('reason', jsonb_build_array('Required (at least 3 characters)'))));
    END IF;

    SELECT * INTO v_a FROM lumbung.agreements a WHERE a.tenant_id = v_tenant AND a.id = p_id;
    IF NOT FOUND THEN
      PERFORM lumbung.lb_raise('NOT_FOUND', '{"message":"Agreement not found"}');
    END IF;
    PERFORM 1 FROM lumbung.agreements a
      WHERE a.tenant_id = v_tenant AND a.flo_id = v_a.flo_id ORDER BY a.id FOR UPDATE;
    SELECT * INTO v_a FROM lumbung.agreements a WHERE a.tenant_id = v_tenant AND a.id = p_id;

    IF p_expected_rev IS NULL OR v_a.revision <> p_expected_rev THEN
      PERFORM lumbung.lb_raise('REVISION_CONFLICT', jsonb_build_object(
        'message', 'The agreement was changed by someone else; reload and try again',
        'current_revision', v_a.revision));
    END IF;
    IF v_a.review_state <> 'APPROVED' THEN
      PERFORM lumbung.lb_raise('INVALID_STATE', jsonb_build_object(
        'message', 'Only an approved agreement can be revoked', 'review_state', v_a.review_state));
    END IF;

    v_now := lumbung.tenant_now();
    UPDATE lumbung.agreements a
       SET review_state = 'REVOKED', revoked_at = v_now, revoke_reason = v_reason,
           revision = a.revision + 1, updated_at = now()
     WHERE a.tenant_id = v_tenant AND a.id = p_id
    RETURNING * INTO v_a;

    UPDATE lumbung.renewal_tasks rt
       SET status = 'CANCELLED', updated_at = now()
     WHERE rt.tenant_id = v_tenant AND rt.agreement_id = v_a.id AND rt.status = 'OPEN';

    -- S2 extends this hook to invalidate affected commitments.
    v_hook := lumbung.on_agreement_revoked(v_a.id, v_a.flo_id, v_reason);

    SELECT f.code INTO v_code FROM lumbung.flos f WHERE f.tenant_id = v_tenant AND f.id = v_a.flo_id;
    INSERT INTO lumbung.tasks (tenant_id, kind, subject_type, subject_id, severity, state, due_at, dedup_key, payload, created_by)
    VALUES (v_tenant, 'AGREEMENT_REVOKED', 'AGREEMENT', v_a.id, 'HIGH', 'OPEN', v_now,
            'agreement-revoked:' || v_a.id::text,
            jsonb_build_object('flo_id', v_a.flo_id, 'flo_code', v_code, 'agreement_version', v_a.version,
                               'reason', v_reason, 'commitments', v_hook),
            lumbung.current_user_id())
    ON CONFLICT (tenant_id, dedup_key) DO NOTHING
    RETURNING id INTO v_task;

    v_res := jsonb_build_object('agreement', lumbung.agreement_json(v_a, v_now),
                                'task_id', v_task, 'commitments', v_hook);
    PERFORM lumbung.append_audit('AGREEMENT_REVOKED', 'AGREEMENT', v_a.id, v_a.revision, v_reason,
      jsonb_build_object('flo_id', v_a.flo_id, 'commitments', v_hook), NULL, to_jsonb(v_a));
    PERFORM lumbung.emit_event('AgreementRevoked', 'AGREEMENT', v_a.id, v_a.revision,
      jsonb_build_object('flo_id', v_a.flo_id, 'reason', v_reason));
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

-- ---------------------------------------------------------------------------
-- Need assessments (PRD §5: proposals by staff/agent, confirmation by staff)
-- ---------------------------------------------------------------------------

CREATE FUNCTION lumbung.propose_need(p_flo uuid, p_category uuid, p_score numeric, p_basis text,
    p_requested_qty numeric, p_unit text, p_intended_date date, p_available_stock numeric,
    p_expected_deliveries numeric, p_existing_support text, p_valid_days integer,
    p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := lumbung.require_ctx();
    v_prior  jsonb;
    v_now    timestamptz;
    v_days   integer := coalesce(p_valid_days, 30);
    v_n      lumbung.need_assessments;
    v_res    jsonb;
  BEGIN
    PERFORM lumbung.require_cap('need.propose');
    v_prior := lumbung.idem_begin(p_idem_key, 'propose_need', p_request_hash);
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
    IF p_score IS NULL OR p_score < 0 OR p_score > 100 THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'Score must be 0–100', 'http', 400,
        'field_errors', jsonb_build_object('score', jsonb_build_array('Must be between 0 and 100'))));
    END IF;
    IF v_days < 1 OR v_days > 90 THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'Validity must be 1–90 days', 'http', 400,
        'field_errors', jsonb_build_object('valid_days', jsonb_build_array('Must be between 1 and 90'))));
    END IF;
    IF p_requested_qty IS NOT NULL AND nullif(btrim(coalesce(p_unit, '')), '') IS NULL THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'A quantity needs a unit', 'http', 400,
        'field_errors', jsonb_build_object('unit', jsonb_build_array('Required with a quantity'))));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM lumbung.flos f WHERE f.tenant_id = v_tenant AND f.id = p_flo) THEN
      PERFORM lumbung.lb_raise('NOT_FOUND', '{"message":"FLO not found"}');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM lumbung.categories c WHERE c.tenant_id = v_tenant AND c.id = p_category) THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'Unknown category', 'http', 400,
        'field_errors', jsonb_build_object('category_id', jsonb_build_array('Unknown category'))));
    END IF;

    v_now := lumbung.tenant_now();
    INSERT INTO lumbung.need_assessments (
      tenant_id, flo_id, category_id, score, basis, requested_qty, unit, intended_distribution_date,
      available_stock_qty, expected_deliveries_qty, existing_support, assessor_id, assessed_at, expires_at,
      status, created_by)
    VALUES (
      v_tenant, p_flo, p_category, p_score, nullif(btrim(coalesce(p_basis, '')), ''), p_requested_qty,
      nullif(btrim(coalesce(p_unit, '')), ''), p_intended_date, p_available_stock, p_expected_deliveries,
      nullif(btrim(coalesce(p_existing_support, '')), ''), lumbung.current_user_id(), v_now,
      v_now + make_interval(days => v_days), 'PROPOSED', lumbung.current_user_id())
    RETURNING * INTO v_n;

    v_res := jsonb_build_object('need_id', v_n.id, 'flo_id', v_n.flo_id, 'category_id', v_n.category_id,
                                'score', v_n.score, 'status', v_n.status,
                                'assessed_at', v_n.assessed_at, 'expires_at', v_n.expires_at);
    PERFORM lumbung.append_audit('NEED_PROPOSED', 'NEED_ASSESSMENT', v_n.id, NULL, NULL,
      jsonb_build_object('flo_id', p_flo, 'category_id', p_category, 'score', p_score), NULL, to_jsonb(v_n));
    PERFORM lumbung.emit_event('NeedProposed', 'NEED_ASSESSMENT', v_n.id, NULL, v_res);
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

CREATE FUNCTION lumbung.confirm_need(p_need uuid, p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant uuid := lumbung.require_ctx();
    v_prior  jsonb;
    v_n      lumbung.need_assessments;
    v_now    timestamptz;
    v_res    jsonb;
  BEGIN
    PERFORM lumbung.require_cap('need.confirm');
    v_prior := lumbung.idem_begin(p_idem_key, 'confirm_need', p_request_hash);
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
    SELECT * INTO v_n FROM lumbung.need_assessments n
     WHERE n.tenant_id = v_tenant AND n.id = p_need FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM lumbung.lb_raise('NOT_FOUND', '{"message":"Need assessment not found"}');
    END IF;
    IF v_n.status <> 'PROPOSED' THEN
      PERFORM lumbung.lb_raise('INVALID_STATE', jsonb_build_object(
        'message', 'Only a proposed need can be confirmed', 'status', v_n.status));
    END IF;
    v_now := lumbung.tenant_now();
    IF v_n.expires_at <= v_now THEN
      PERFORM lumbung.lb_raise('NEED_EXPIRED', jsonb_build_object(
        'message', 'The proposal has expired; propose a fresh assessment', 'expires_at', v_n.expires_at));
    END IF;
    UPDATE lumbung.need_assessments n
       SET status = 'CONFIRMED', confirmed_by = lumbung.current_user_id(), updated_at = now()
     WHERE n.tenant_id = v_tenant AND n.id = p_need
    RETURNING * INTO v_n;

    v_res := jsonb_build_object('need_id', v_n.id, 'flo_id', v_n.flo_id, 'category_id', v_n.category_id,
                                'score', v_n.score, 'status', v_n.status, 'confirmed_by', v_n.confirmed_by,
                                'assessed_at', v_n.assessed_at, 'expires_at', v_n.expires_at);
    PERFORM lumbung.append_audit('NEED_CONFIRMED', 'NEED_ASSESSMENT', v_n.id, NULL, NULL,
      jsonb_build_object('flo_id', v_n.flo_id, 'category_id', v_n.category_id, 'score', v_n.score,
                         'assessor_id', v_n.assessor_id),
      NULL, to_jsonb(v_n));
    PERFORM lumbung.emit_event('NeedConfirmed', 'NEED_ASSESSMENT', v_n.id, NULL, v_res);
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

-- ---------------------------------------------------------------------------
-- Privileges: default privileges already keep these off PUBLIC; be explicit.
-- Internal helpers stay owner-only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  lumbung.lb_raise(text, jsonb),
  lumbung.idem_begin(text, text, text),
  lumbung.idem_complete(text, jsonb, integer),
  lumbung.append_audit(text, text, uuid, integer, text, jsonb, jsonb, jsonb, uuid),
  lumbung.emit_event(text, text, uuid, integer, jsonb),
  lumbung.agreement_json(lumbung.agreements, timestamptz),
  lumbung.on_agreement_revoked(uuid, uuid, text),
  lumbung.create_flo(jsonb, text, text),
  lumbung.update_flo_profile(uuid, integer, jsonb, text, text),
  lumbung.upload_agreement(uuid, uuid, date, date, date, text, text),
  lumbung.approve_agreement(uuid, integer, text, text, text),
  lumbung.revoke_agreement(uuid, integer, text, text, text),
  lumbung.propose_need(uuid, uuid, numeric, text, numeric, text, date, numeric, numeric, text, integer, text, text),
  lumbung.confirm_need(uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  lumbung.create_flo(jsonb, text, text),
  lumbung.update_flo_profile(uuid, integer, jsonb, text, text),
  lumbung.upload_agreement(uuid, uuid, date, date, date, text, text),
  lumbung.approve_agreement(uuid, integer, text, text, text),
  lumbung.revoke_agreement(uuid, integer, text, text, text),
  lumbung.propose_need(uuid, uuid, numeric, text, numeric, text, date, numeric, numeric, text, integer, text, text),
  lumbung.confirm_need(uuid, text, text)
TO lumbung_app;
