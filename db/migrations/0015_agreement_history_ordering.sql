-- 0015_agreement_history_ordering (Stage 1 review fixes; Stage-1 range 0001–0019).
--
-- 1. Supersession caps a version instead of erasing it (PRD §5: "Approved future renewals
--    can have future validity without activating early", "renewals must not overwrite old
--    agreement versions", "record the facts ... without rewriting history").
--      superseded_from   instant from which the approved successor replaces this version
--      superseded_at     tenant time at which the resolution was recorded
--      superseded_by_id  the successor
--      effective_until   GENERATED least(valid_until_exclusive, superseded_from)
--    approve_agreement(..., 'SUPERSEDE_PREVIOUS'):
--      successor starts AFTER the old version starts → the old version stays APPROVED and is
--        effective on [valid_from, successor.valid_from) (TRUNCATED; no coverage gap: a
--        renewal approved early does not end the current agreement early);
--      successor starts AT/BEFORE the old version's start → review_state SUPERSEDED
--        (REPLACED; nothing of the old interval remains in force).
--    The legal dates are never changed. A resolution that would leave the FLO without a
--    valid agreement at tenant_now() although it had one is refused
--    (LB:AGREEMENT_RESOLUTION_GAP). Truncated versions' open renewal tasks become DONE
--    (renewed), replaced versions' are CANCELLED.
--
-- 2. Forward-looking vs historical validity:
--      agreement_valid_at[_for](flo, t)    APPROVED and valid_from <= t < effective_until.
--                                          Eligibility "now" and at a planned handover.
--      agreement_was_valid_at_for(tenant, flo, t)   owner-only. Was an approved agreement in
--                                          force at t AS RECORDED AT THE TIME: a REVOKED
--                                          version counts before revoked_at; a capped or
--                                          SUPERSEDED version counts on its legal interval
--                                          before superseded_at and on its capped interval
--                                          afterwards. verify_tenant_invariants uses it for
--                                          HANDOVER/DISPATCH_AGREEMENT_INVALID, so a later
--                                          revocation (SC06) or renewal (AC04) never turns
--                                          legitimately covered history into violations.
--      agreement_status(a, t)              APPROVED and t >= superseded_from → 'SUPERSEDED'.
--      AGREEMENT_OVERLAP compares effective intervals.
--
-- 3. Document interpretation (PRD §5 "Store the document interpretation used; do not infer
--    inclusive dates from an unreviewed file"): document_end_date (the end date as written),
--    end_date_interpretation THROUGH_INCLUSIVE ("berlaku sampai dengan 30 Nov") |
--    UNTIL_EXCLUSIVE ("berakhir 1 Des"), interpretation_note. upload_agreement now requires
--    the interpretation and derives valid_through_date from it; both are audited. Rows that
--    predate this migration keep NULL (= not recorded) — nothing is inferred for them.
--
-- 4. seq bigint identity on audit_events, domain_events and need_assessments: a monotonic
--    tie-breaker. Under the FROZEN demo clock every command stamps the same tenant_now(), so
--    (occurred_at, id) ordering was decided by random UUIDs.

SET LOCAL search_path = lumbung, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. agreements: supersession cap + interpretation columns
-- ---------------------------------------------------------------------------
ALTER TABLE lumbung.agreements
  ADD COLUMN superseded_from          timestamptz,
  ADD COLUMN superseded_at            timestamptz,
  ADD COLUMN superseded_by_id         uuid,
  ADD COLUMN document_end_date        date,
  ADD COLUMN end_date_interpretation  text,
  ADD COLUMN interpretation_note      text;

-- Backfill rows superseded under the 0013 semantics (whole interval dropped). A version
-- whose successor starts later is restored to APPROVED with a cap at the successor's start;
-- otherwise it stays SUPERSEDED with an empty remaining window.
UPDATE lumbung.agreements o
   SET superseded_by_id = s.id,
       superseded_at = coalesce(s.reviewed_at, o.reviewed_at, o.updated_at),
       superseded_from = CASE WHEN s.valid_from > o.valid_from AND s.valid_from < o.valid_until_exclusive
                              THEN s.valid_from ELSE o.valid_from END,
       review_state = CASE WHEN s.valid_from > o.valid_from AND s.valid_from < o.valid_until_exclusive
                           THEN 'APPROVED' ELSE 'SUPERSEDED' END
  FROM (SELECT DISTINCT ON (x.tenant_id, x.supersedes_id) x.tenant_id, x.supersedes_id, x.id, x.valid_from, x.reviewed_at
          FROM lumbung.agreements x
         WHERE x.supersedes_id IS NOT NULL
         ORDER BY x.tenant_id, x.supersedes_id, x.valid_from, x.id) s
 WHERE o.review_state = 'SUPERSEDED' AND s.tenant_id = o.tenant_id AND s.supersedes_id = o.id;

UPDATE lumbung.agreements o
   SET superseded_at = coalesce(o.reviewed_at, o.updated_at), superseded_from = o.valid_from
 WHERE o.review_state = 'SUPERSEDED' AND o.superseded_at IS NULL;

ALTER TABLE lumbung.agreements
  ADD COLUMN effective_until timestamptz GENERATED ALWAYS AS (least(valid_until_exclusive, superseded_from)) STORED,
  ADD CONSTRAINT agreements_superseded_by_fk
    FOREIGN KEY (tenant_id, superseded_by_id) REFERENCES lumbung.agreements(tenant_id, id),
  ADD CONSTRAINT agreements_supersession_chk CHECK (
        (superseded_from IS NULL) = (superseded_at IS NULL)
    AND (superseded_from IS NULL OR (superseded_from >= valid_from AND superseded_from < valid_until_exclusive))
    AND (review_state <> 'SUPERSEDED' OR superseded_at IS NOT NULL)
    AND (review_state <> 'APPROVED' OR superseded_from IS NULL OR superseded_from > valid_from)),
  ADD CONSTRAINT agreements_interpretation_chk CHECK (
        (end_date_interpretation IS NULL AND document_end_date IS NULL)
     OR (end_date_interpretation = 'THROUGH_INCLUSIVE' AND document_end_date = valid_through_date)
     OR (end_date_interpretation = 'UNTIL_EXCLUSIVE' AND document_end_date = valid_through_date + 1)),
  ADD CONSTRAINT agreements_interpretation_note_chk CHECK (interpretation_note IS NULL OR length(interpretation_note) <= 1000);

DROP INDEX lumbung.agreements_approved_interval_idx;
CREATE INDEX agreements_approved_interval_idx
  ON lumbung.agreements (tenant_id, flo_id, valid_from, effective_until)
  WHERE review_state = 'APPROVED';

-- ---------------------------------------------------------------------------
-- 2. Validity helpers
-- ---------------------------------------------------------------------------

-- Forward-looking: the APPROVED agreement in force at p_t (capped by any approved successor).
CREATE OR REPLACE FUNCTION lumbung.agreement_valid_at_for(p_tenant uuid, p_flo uuid, p_t timestamptz) RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT a.id
      FROM lumbung.agreements a
     WHERE a.tenant_id = p_tenant
       AND a.flo_id = p_flo
       AND a.review_state = 'APPROVED'
       AND a.valid_from <= p_t
       AND p_t < a.effective_until
     ORDER BY a.valid_from DESC, a.id
     LIMIT 1
  $$;

CREATE OR REPLACE FUNCTION lumbung.agreement_valid_at(p_flo uuid, p_t timestamptz) RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT a.id
      FROM lumbung.agreements a
     WHERE a.tenant_id = lumbung.current_tenant()
       AND a.flo_id = p_flo
       AND a.review_state = 'APPROVED'
       AND a.valid_from <= p_t
       AND p_t < a.effective_until
     ORDER BY a.valid_from DESC, a.id
     LIMIT 1
  $$;

-- Historical: was an approved agreement in force at p_t, as recorded at that time?
-- Owner-only (explicit tenant; used by verify_tenant_invariants).
CREATE FUNCTION lumbung.agreement_was_valid_at_for(p_tenant uuid, p_flo uuid, p_t timestamptz) RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT a.id
      FROM lumbung.agreements a
     WHERE a.tenant_id = p_tenant
       AND a.flo_id = p_flo
       AND a.review_state IN ('APPROVED', 'SUPERSEDED', 'REVOKED')
       AND a.valid_from <= p_t
       AND p_t < CASE WHEN a.superseded_at IS NOT NULL AND p_t >= a.superseded_at
                      THEN a.effective_until ELSE a.valid_until_exclusive END
       AND (a.revoked_at IS NULL OR p_t < a.revoked_at)
     ORDER BY a.valid_from DESC, a.id
     LIMIT 1
  $$;

-- Derived lifecycle at t. An APPROVED version capped by a successor reads SUPERSEDED from
-- superseded_from on (it ended because it was replaced, not because it expired).
CREATE OR REPLACE FUNCTION lumbung.agreement_status(a lumbung.agreements, t timestamptz) RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT CASE
      WHEN a.review_state <> 'APPROVED' THEN a.review_state
      WHEN t < a.valid_from THEN 'SCHEDULED'
      WHEN a.superseded_from IS NOT NULL AND t >= a.superseded_from THEN 'SUPERSEDED'
      WHEN t >= a.valid_until_exclusive THEN 'EXPIRED'
      ELSE 'ACTIVE'
    END
  $$;

-- EXPIRING_SOON: ACTIVE, not already renewed by an approved successor, and at most
-- p_window left until the legal exclusive end.
CREATE OR REPLACE FUNCTION lumbung.agreement_is_expiring_soon(
    a lumbung.agreements, t timestamptz, p_window interval DEFAULT interval '30 days') RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT lumbung.agreement_status(a, t) = 'ACTIVE'
       AND a.superseded_from IS NULL
       AND a.valid_until_exclusive - t <= p_window
  $$;

CREATE OR REPLACE FUNCTION lumbung.agreement_json(a lumbung.agreements, t timestamptz) RETURNS jsonb
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
      'document_end_date', a.document_end_date,
      'end_date_interpretation', a.end_date_interpretation,
      'interpretation_note', a.interpretation_note,
      'valid_from', a.valid_from,
      'valid_until_exclusive', a.valid_until_exclusive,
      'effective_until', a.effective_until,
      'superseded_from', a.superseded_from,
      'superseded_at', a.superseded_at,
      'superseded_by_id', a.superseded_by_id,
      'uploaded_by', a.uploaded_by,
      'reviewer_id', a.reviewer_id,
      'reviewed_at', a.reviewed_at,
      'revoked_at', a.revoked_at,
      'revoke_reason', a.revoke_reason,
      'supersedes_id', a.supersedes_id,
      'revision', a.revision)
  $$;

-- ---------------------------------------------------------------------------
-- 3. upload_agreement: the document interpretation is required and stored
-- ---------------------------------------------------------------------------
DROP FUNCTION lumbung.upload_agreement(uuid, uuid, date, date, date, text, text);

CREATE FUNCTION lumbung.upload_agreement(p_flo uuid, p_media uuid, p_signed date, p_from date,
    p_document_end date, p_end_interpretation text, p_interpretation_note text,
    p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant  uuid := lumbung.require_ctx();
    v_prior   jsonb;
    v_tz      text;
    v_through date;
    v_note    text := nullif(btrim(coalesce(p_interpretation_note, '')), '');
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

    IF p_from IS NULL OR p_document_end IS NULL THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'Legal dates are required', 'http', 400,
        'field_errors', jsonb_build_object('valid_from_date', jsonb_build_array('Required'),
                                           'document_end_date', jsonb_build_array('Required'))));
    END IF;
    IF p_end_interpretation IS NULL OR p_end_interpretation NOT IN ('THROUGH_INCLUSIVE', 'UNTIL_EXCLUSIVE') THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object(
        'message', 'State how the document''s end date is worded (inclusive "through" or exclusive "until")', 'http', 400,
        'field_errors', jsonb_build_object('end_date_interpretation',
          jsonb_build_array('Required: THROUGH_INCLUSIVE or UNTIL_EXCLUSIVE'))));
    END IF;
    IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
      PERFORM lumbung.lb_raise('VALIDATION_FAILED', jsonb_build_object('message', 'Interpretation note too long', 'http', 400,
        'field_errors', jsonb_build_object('interpretation_note', jsonb_build_array('At most 1000 characters'))));
    END IF;
    v_through := CASE p_end_interpretation WHEN 'THROUGH_INCLUSIVE' THEN p_document_end ELSE p_document_end - 1 END;
    IF v_through < p_from THEN
      PERFORM lumbung.lb_raise('AGREEMENT_INVALID_INTERVAL', jsonb_build_object(
        'message', 'The end date must leave at least one valid day after the start date',
        'field_errors', jsonb_build_object('document_end_date', jsonb_build_array('Must be after the start date'))));
    END IF;
    IF p_signed IS NOT NULL AND p_signed > v_through THEN
      PERFORM lumbung.lb_raise('AGREEMENT_INVALID_INTERVAL', jsonb_build_object(
        'message', 'signed_date must not be after the last valid day',
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
      document_end_date, end_date_interpretation, interpretation_note,
      valid_from, valid_until_exclusive, review_state, uploaded_by, created_by)
    VALUES (
      v_tenant, p_flo, p_media, v_version, p_signed, p_from, v_through,
      p_document_end, p_end_interpretation, v_note,
      p_from::timestamp AT TIME ZONE v_tz, (v_through + 1)::timestamp AT TIME ZONE v_tz,
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
                         'valid_from_date', p_from, 'document_end_date', p_document_end,
                         'end_date_interpretation', p_end_interpretation, 'interpretation_note', v_note,
                         'valid_through_date', v_through, 'valid_until_exclusive', v_a.valid_until_exclusive,
                         'document_media_id', p_media, 'timezone', v_tz),
      NULL, to_jsonb(v_a));
    PERFORM lumbung.emit_event('AgreementUploaded', 'AGREEMENT', v_a.id, v_a.revision,
      jsonb_build_object('flo_id', p_flo, 'version', v_a.version));
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

-- ---------------------------------------------------------------------------
-- approve_agreement: SUPERSEDE_PREVIOUS truncates (or replaces) instead of erasing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lumbung.approve_agreement(p_id uuid, p_expected_rev integer, p_overlap_resolution text,
    p_idem_key text, p_request_hash text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    v_tenant     uuid := lumbung.require_ctx();
    v_prior      jsonb;
    v_a          lumbung.agreements;
    v_now        timestamptz;
    v_before     uuid;
    v_overlap    uuid[];
    v_sup        lumbung.agreements;
    v_superseded jsonb := '[]'::jsonb;
    v_truncated  jsonb := '[]'::jsonb;
    v_replaced   jsonb := '[]'::jsonb;
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
    v_before := lumbung.agreement_valid_at_for(v_tenant, v_a.flo_id, v_now);

    -- Overlap with the EFFECTIVE interval of other approved versions.
    SELECT array_agg(o.id ORDER BY o.valid_from, o.id) INTO v_overlap
      FROM lumbung.agreements o
     WHERE o.tenant_id = v_tenant AND o.flo_id = v_a.flo_id AND o.id <> v_a.id
       AND o.review_state = 'APPROVED'
       AND o.valid_from < v_a.valid_until_exclusive AND v_a.valid_from < o.effective_until;

    IF v_overlap IS NOT NULL THEN
      IF p_overlap_resolution IS NULL THEN
        PERFORM lumbung.lb_raise('AGREEMENT_OVERLAP_UNRESOLVED', jsonb_build_object(
          'message', 'The interval overlaps an approved agreement; choose an explicit resolution',
          'overlapping_agreement_ids', to_jsonb(v_overlap),
          'allowed_resolutions', jsonb_build_array('SUPERSEDE_PREVIOUS')));
      END IF;
      FOR v_sup IN
        SELECT * FROM lumbung.agreements a
         WHERE a.tenant_id = v_tenant AND a.id = ANY (v_overlap)
         ORDER BY a.valid_from, a.id
      LOOP
        v_superseded := v_superseded || to_jsonb(v_sup.id);
        IF v_a.valid_from > v_sup.valid_from THEN
          -- TRUNCATED: stays approved and in force until the successor starts.
          UPDATE lumbung.agreements a
             SET superseded_from = v_a.valid_from, superseded_at = v_now, superseded_by_id = v_a.id,
                 revision = a.revision + 1, updated_at = now()
           WHERE a.tenant_id = v_tenant AND a.id = v_sup.id
          RETURNING a.* INTO v_sup;
          v_truncated := v_truncated || to_jsonb(v_sup.id);
          UPDATE lumbung.renewal_tasks rt
             SET status = 'DONE', submitted_agreement_id = v_a.id, updated_at = now()
           WHERE rt.tenant_id = v_tenant AND rt.agreement_id = v_sup.id AND rt.status = 'OPEN';
          PERFORM lumbung.append_audit('AGREEMENT_SUPERSEDED', 'AGREEMENT', v_sup.id, v_sup.revision, NULL,
            jsonb_build_object('flo_id', v_sup.flo_id, 'superseded_by', v_a.id, 'resolution', p_overlap_resolution,
                               'mode', 'TRUNCATED', 'effective_until', v_sup.effective_until,
                               'legal_valid_until_exclusive', v_sup.valid_until_exclusive));
        ELSE
          -- REPLACED: the successor covers the whole remaining interval from its start.
          UPDATE lumbung.agreements a
             SET review_state = 'SUPERSEDED', superseded_from = a.valid_from, superseded_at = v_now,
                 superseded_by_id = v_a.id, revision = a.revision + 1, updated_at = now()
           WHERE a.tenant_id = v_tenant AND a.id = v_sup.id
          RETURNING a.* INTO v_sup;
          v_replaced := v_replaced || to_jsonb(v_sup.id);
          UPDATE lumbung.renewal_tasks rt
             SET status = 'CANCELLED', submitted_agreement_id = v_a.id, updated_at = now()
           WHERE rt.tenant_id = v_tenant AND rt.agreement_id = v_sup.id AND rt.status = 'OPEN';
          PERFORM lumbung.append_audit('AGREEMENT_SUPERSEDED', 'AGREEMENT', v_sup.id, v_sup.revision, NULL,
            jsonb_build_object('flo_id', v_sup.flo_id, 'superseded_by', v_a.id, 'resolution', p_overlap_resolution,
                               'mode', 'REPLACED', 'legal_valid_until_exclusive', v_sup.valid_until_exclusive));
        END IF;
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

    -- Never leave the FLO without a valid agreement now when it had one before.
    IF v_before IS NOT NULL AND lumbung.agreement_valid_at_for(v_tenant, v_a.flo_id, v_now) IS NULL THEN
      PERFORM lumbung.lb_raise('AGREEMENT_RESOLUTION_GAP', jsonb_build_object(
        'message', 'This resolution would leave the FLO without a valid agreement now',
        'current_agreement_id', v_before, 'at', v_now));
    END IF;

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
      'truncated_agreement_ids', v_truncated,
      'replaced_agreement_ids', v_replaced,
      'renewal_tasks_created', v_tasks,
      'renewal_tasks_closed', v_closed);
    PERFORM lumbung.append_audit('AGREEMENT_APPROVED', 'AGREEMENT', v_a.id, v_a.revision, NULL,
      jsonb_build_object('flo_id', v_a.flo_id, 'valid_from_date', v_a.valid_from_date,
                         'valid_through_date', v_a.valid_through_date,
                         'valid_until_exclusive', v_a.valid_until_exclusive,
                         'document_end_date', v_a.document_end_date,
                         'end_date_interpretation', v_a.end_date_interpretation,
                         'interpretation_note', v_a.interpretation_note,
                         'overlap_resolution', p_overlap_resolution, 'superseded_agreement_ids', v_superseded,
                         'truncated_agreement_ids', v_truncated, 'replaced_agreement_ids', v_replaced),
      NULL, to_jsonb(v_a));
    PERFORM lumbung.emit_event('AgreementApproved', 'AGREEMENT', v_a.id, v_a.revision,
      jsonb_build_object('flo_id', v_a.flo_id, 'superseded_agreement_ids', v_superseded));
    PERFORM lumbung.idem_complete(p_idem_key, v_res);
    RETURN v_res;
  END
  $$;

-- ---------------------------------------------------------------------------
-- verify_tenant_invariants: historical coverage + effective overlap
-- (identical to 0011 otherwise)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lumbung.verify_tenant_invariants(p_tenant uuid)
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
     AND a.valid_from < b.effective_until AND b.valid_from < a.effective_until
   WHERE a.tenant_id = p_tenant AND a.review_state = 'APPROVED'

  UNION ALL
  -- HANDOVER_AGREEMENT_INVALID
  SELECT 'HANDOVER_AGREEMENT_INVALID', 'FLO_RECEIPT', r.id,
         jsonb_build_object('flo_id', r.flo_id, 'received_at', r.received_at, 'delivery_id', r.delivery_id)
    FROM lumbung.flo_receipts r
   WHERE r.tenant_id = p_tenant AND r.status = 'CURRENT'
     AND lumbung.agreement_was_valid_at_for(p_tenant, r.flo_id, r.received_at) IS NULL
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
     AND lumbung.agreement_was_valid_at_for(p_tenant, d.destination_flo_id, d.dispatched_at) IS NULL
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
-- 4. Monotonic tie-breakers (FROZEN clock: identical instants for every command)
-- ---------------------------------------------------------------------------
ALTER TABLE lumbung.audit_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE lumbung.domain_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE lumbung.need_assessments ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

DROP INDEX lumbung.audit_events_occurred_idx;
CREATE INDEX audit_events_occurred_idx ON lumbung.audit_events (tenant_id, occurred_at, seq);
CREATE INDEX domain_events_occurred_idx ON lumbung.domain_events (tenant_id, occurred_at, seq);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  lumbung.agreement_was_valid_at_for(uuid, uuid, timestamptz),
  lumbung.upload_agreement(uuid, uuid, date, date, date, text, text, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  lumbung.upload_agreement(uuid, uuid, date, date, date, text, text, text, text)
TO lumbung_app;
