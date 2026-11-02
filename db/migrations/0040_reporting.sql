SET LOCAL search_path=lumbung,pg_temp;

ALTER TABLE media_files ADD COLUMN subject_id uuid, ADD COLUMN subject_type text;
ALTER TABLE distribution_events ADD COLUMN revision integer NOT NULL DEFAULT 1;

CREATE FUNCTION lumbung.compute_due_at(p_rule text,p_anchor timestamptz,p_tz text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path=lumbung,pg_temp AS $$
BEGIN
  CASE p_rule
    WHEN 'AT_RECEIPT' THEN RETURN p_anchor;
    WHEN 'ROLLING_24H' THEN RETURN p_anchor+interval '24 hours';
    WHEN 'CALENDAR_NEXT_DAY_EOD' THEN RETURN (((p_anchor AT TIME ZONE p_tz)::date+2)::timestamp AT TIME ZONE p_tz)-interval '1 microsecond';
    ELSE PERFORM lb_raise('BAD_REQUEST');
  END CASE;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.compute_due_at(text,timestamptz,text) TO lumbung_app;

-- A FLO bearer link grants only its recorded subject and actions, never network access.
CREATE FUNCTION lumbung.assert_flo_scope(p_flo uuid,p_subject uuid,p_cap text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=lumbung,pg_temp AS $$
BEGIN
  PERFORM require_cap(p_cap);
  IF current_actor_kind()='FLO_LINK' AND NOT EXISTS(SELECT 1 FROM flo_access_links l
    WHERE l.tenant_id=current_tenant() AND l.id=current_link_id() AND l.flo_id=p_flo
      AND l.subject_id=p_subject AND l.revoked_at IS NULL AND l.expires_at>tenant_now()) THEN
    PERFORM lb_raise('FORBIDDEN','{"http":403}');
  END IF;
END $$;

CREATE FUNCTION lumbung.obligation_flo(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path=lumbung,pg_temp AS $$
 SELECT coalesce(d.destination_flo_id,e.flo_id) FROM evidence_obligations o
 LEFT JOIN deliveries d ON d.tenant_id=o.tenant_id AND o.subject_type='DELIVERY' AND d.id=o.subject_id
 LEFT JOIN distribution_events e ON e.tenant_id=o.tenant_id AND o.subject_type='DISTRIBUTION_EVENT' AND e.id=o.subject_id
 WHERE o.tenant_id=current_tenant() AND o.id=p_id
$$;
CREATE FUNCTION lumbung.obligation_delivery(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path=lumbung,pg_temp AS $$
 SELECT coalesce(d.id,r.delivery_id) FROM evidence_obligations o
 LEFT JOIN deliveries d ON d.tenant_id=o.tenant_id AND o.subject_type='DELIVERY' AND d.id=o.subject_id
 LEFT JOIN distribution_events e ON e.tenant_id=o.tenant_id AND o.subject_type='DISTRIBUTION_EVENT' AND e.id=o.subject_id
 LEFT JOIN flo_receipts r ON r.tenant_id=e.tenant_id AND r.id=e.receipt_id
 WHERE o.tenant_id=current_tenant() AND o.id=p_id
$$;

CREATE FUNCTION lumbung.reporting_command(p_action text,p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); cap text; replay jsonb; result jsonb; o evidence_obligations; s evidence_submissions;
  rid uuid; mid uuid; pol policy_versions; tz text; r flo_receipts; rl receipt_lines; line jsonb; used numeric; qty numeric; lost numeric; remaining numeric; consumed numeric;
  event_id uuid; due_rule text; submission_id uuid; v int; v_state text; before_facts jsonb;
BEGIN
  cap:=CASE p_action WHEN 'submit' THEN 'evidence.submit' WHEN 'review' THEN 'evidence.review'
    WHEN 'excuse' THEN 'evidence.excuse' WHEN 'distribution' THEN 'evidence.submit' END;
  IF cap IS NULL THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  PERFORM require_cap(cap);
  IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED','{"http":400}'); END IF;
  replay:=idem_begin(p_key,'report:'||p_action,canonical_hash(jsonb_build_object('id',p_id,'body',p,'hash',p_hash)));
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  IF p_action IN('submit','excuse') THEN
    SELECT * INTO o FROM evidence_obligations WHERE tenant_id=t AND id=p_id FOR UPDATE;
    IF o.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
    IF o.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
    PERFORM assert_flo_scope(obligation_flo(o.id),obligation_delivery(o.id),cap);
    before_facts:=to_jsonb(o);
    IF p_action='excuse' THEN
      IF current_actor_kind()<>'USER' OR length(trim(coalesce(p->>'reason','')))<3 OR length(trim(coalesce(p->>'category','')))<2 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
      UPDATE evidence_obligations SET state='EXCUSED',excuse_category=p->>'category',excuse_explanation=p->>'reason',excused_by=current_user_id(),excused_at=tenant_now(),revision=revision+1
        WHERE tenant_id=t AND id=o.id RETURNING * INTO o;
    ELSE
      IF o.state NOT IN('OPEN','NEEDS_CLARIFICATION') THEN PERFORM lb_raise('INVALID_STATE'); END IF;
      IF coalesce(jsonb_array_length(p->'media_ids'),0)=0 AND length(trim(coalesce(p->>'note','')))<10 THEN PERFORM lb_raise('EVIDENCE_REQUIRED'); END IF;
      SELECT coalesce(max(version),0)+1 INTO v FROM evidence_submissions WHERE tenant_id=t AND obligation_id=o.id;
      INSERT INTO evidence_submissions(tenant_id,obligation_id,version,submitted_at,ingested_at,time_source,channel,actor,note,supersedes_id,created_by)
        VALUES(t,o.id,v,tenant_now(),clock_timestamp(),'SERVER','WEB',current_user_id(),p->>'note',
          (SELECT id FROM evidence_submissions WHERE tenant_id=t AND obligation_id=o.id ORDER BY version DESC LIMIT 1),current_user_id()) RETURNING id INTO submission_id;
      FOR line IN SELECT * FROM jsonb_array_elements(coalesce(p->'media_ids','[]')) LOOP
        mid:=(line#>>'{}')::uuid;
        IF NOT EXISTS(SELECT 1 FROM media_files m WHERE m.tenant_id=t AND m.id=mid AND m.deletion_state='ACTIVE'
          AND m.subject_id=obligation_delivery(o.id) AND (current_actor_kind()<>'FLO_LINK' OR m.created_by IS NULL)) THEN PERFORM lb_raise('MEDIA_SCOPE_INVALID'); END IF;
        INSERT INTO submission_files(tenant_id,submission_id,media_id,created_by) VALUES(t,submission_id,mid,current_user_id());
        IF EXISTS(SELECT 1 FROM media_files m WHERE m.tenant_id=t AND m.id=mid AND m.duplicate_of_media_id IS NOT NULL) THEN
          INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
            VALUES(t,'DUPLICATE_EVIDENCE','OBLIGATION',o.id,'MEDIUM','duplicate-evidence:'||o.id||':'||mid,'{"automatic_fraud_verdict":false}') ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
      UPDATE evidence_obligations SET state='SUBMITTED',resolved_submission_id=submission_id,revision=revision+1
        WHERE tenant_id=t AND id=o.id RETURNING * INTO o;
    END IF;
    result:=jsonb_build_object('id',o.id,'revision',o.revision,'state',o.state,'submission_id',submission_id);
  ELSIF p_action='review' THEN
    IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
    SELECT * INTO s FROM evidence_submissions WHERE tenant_id=t AND id=p_id;
    IF s.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
    SELECT * INTO o FROM evidence_obligations WHERE tenant_id=t AND id=s.obligation_id FOR UPDATE;
    IF o.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
    IF o.state NOT IN('SUBMITTED','UNDER_REVIEW') OR o.resolved_submission_id<>s.id THEN PERFORM lb_raise('INVALID_STATE'); END IF;
    IF p->>'outcome' NOT IN('ADEQUATE','NEEDS_CLARIFICATION','REJECTED_FINAL') OR length(trim(coalesce(p->>'comments','')))<3 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
    IF p->>'outcome'='ADEQUATE' AND NOT ((p->'checklist') @> '{"correct_subject":true,"quantity_plausible":true,"privacy_appropriate":true}'::jsonb) THEN PERFORM lb_raise('REVIEW_CHECKLIST_REQUIRED'); END IF;
    before_facts:=to_jsonb(o);
    INSERT INTO evidence_reviews(tenant_id,submission_id,reviewer_id,reviewed_at,outcome,final,checklist,comments)
      VALUES(t,s.id,current_user_id(),tenant_now(),p->>'outcome',p->>'outcome'='REJECTED_FINAL',coalesce(p->'checklist','{}'),p->>'comments');
    v_state:=CASE p->>'outcome' WHEN 'ADEQUATE' THEN 'ACCEPTED' ELSE p->>'outcome' END;
    UPDATE evidence_obligations SET state=v_state,revision=revision+1,
      resolved_timeliness=CASE WHEN v_state='ACCEPTED' THEN CASE WHEN s.submitted_at<=due_at THEN 'ON_TIME' ELSE 'LATE' END WHEN v_state='REJECTED_FINAL' THEN 'MISSING' ELSE NULL END
      WHERE tenant_id=t AND id=o.id RETURNING * INTO o;
    result:=jsonb_build_object('id',o.id,'revision',o.revision,'state',o.state,'timeliness',o.resolved_timeliness);
  ELSE
    SELECT * INTO r FROM flo_receipts WHERE tenant_id=t AND id=(p->>'receipt_id')::uuid FOR UPDATE;
    IF r.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
    PERFORM assert_flo_scope(r.flo_id,r.delivery_id,'evidence.submit');
    IF r.status<>'CURRENT' OR (p->>'occurred_at')::timestamptz<r.received_at OR (p->>'occurred_at')::timestamptz>tenant_now()+interval '5 minutes'
      OR p->>'occurred_at' IS NULL OR jsonb_array_length(p->'lines') NOT BETWEEN 1 AND 20 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
    INSERT INTO distribution_events(tenant_id,flo_id,receipt_id,occurred_at,occurrence_time_source,reported_at,people_reported,planned,created_by)
      VALUES(t,r.flo_id,r.id,(p->>'occurred_at')::timestamptz,'FLO_REPORTED',tenant_now(),(p->>'people_reported')::int,false,current_user_id()) RETURNING id INTO event_id;
    FOR line IN SELECT * FROM jsonb_array_elements(p->'lines') LOOP
      SELECT * INTO rl FROM receipt_lines WHERE tenant_id=t AND id=(line->>'receipt_line_id')::uuid AND receipt_id=r.id AND is_current FOR UPDATE;
      IF rl.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
      qty:=(line->>'distributed_quantity')::numeric; lost:=coalesce((line->>'loss_quantity')::numeric,0); consumed:=(line->>'reported_consumed_quantity')::numeric;
      IF qty IS NULL OR qty<0 OR lost<0 OR consumed<0 OR consumed>qty THEN PERFORM lb_raise('DISTRIBUTED_EXCEEDS_RECEIPT'); END IF;
      IF EXISTS(SELECT 1 FROM delivery_lines dl WHERE dl.tenant_id=t AND dl.id=rl.delivery_line_id AND dl.unit_kind='COUNT'
        AND (qty<>trunc(qty) OR lost<>trunc(lost) OR consumed<>trunc(consumed))) THEN PERFORM lb_raise('QTY_INCREMENT_VIOLATION'); END IF;
      SELECT coalesce(sum(e.distributed_qty+e.loss_disposed_qty),0) INTO used FROM distribution_event_lines e JOIN receipt_lines previous ON previous.tenant_id=e.tenant_id AND previous.id=e.receipt_line_id WHERE e.tenant_id=t AND previous.delivery_line_id=rl.delivery_line_id;
      remaining:=rl.accepted_qty-used-qty-lost;
      IF remaining<0 OR qty<>round(qty,3) OR lost<>round(lost,3) THEN PERFORM lb_raise('DISTRIBUTED_EXCEEDS_RECEIPT'); END IF;
      INSERT INTO distribution_event_lines(tenant_id,event_id,receipt_line_id,distributed_qty,remaining_qty_snapshot,loss_disposed_qty,reported_consumed_qty,created_by)
        VALUES(t,event_id,rl.id,qty,remaining,lost,consumed,current_user_id());
    END LOOP;
    pol:=direct_policy('REPORTING'); SELECT timezone INTO tz FROM tenants WHERE id=t; due_rule:=pol.body->'due_rules'->>'DISTRIBUTION';
    INSERT INTO evidence_obligations(tenant_id,type,subject_type,subject_id,anchor_kind,anchor_at,due_at,due_rule,timezone,policy_version_id)
      VALUES(t,'DISTRIBUTION','DISTRIBUTION_EVENT',event_id,'DISTRIBUTION',(p->>'occurred_at')::timestamptz,
        compute_due_at(due_rule,(p->>'occurred_at')::timestamptz,tz),due_rule,tz,pol.id);
    UPDATE tasks SET state='DONE' WHERE tenant_id=t AND subject_id=r.delivery_id AND kind='DISTRIBUTION_STATUS_UNKNOWN' AND state IN('OPEN','CLAIMED');
    result:=jsonb_build_object('id',event_id,'revision',1,'state','REPORTED');
  END IF;
  PERFORM append_audit('REPORT_'||upper(p_action),'REPORTING',coalesce(p_id,(result->>'id')::uuid),(result->>'revision')::int,
    coalesce(p->>'reason',p->>'comments'),jsonb_build_object('request',p,'result',result),before_facts,result);
  PERFORM emit_event('REPORT_'||upper(p_action),'REPORTING',(result->>'id')::uuid,(result->>'revision')::int,result);
  PERFORM idem_complete(p_key,result); RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.reporting_command(text,uuid,jsonb,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.register_media(p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); replay jsonb; mid uuid:=(p->>'id')::uuid; subject uuid:=(p->>'subject_id')::uuid; dup uuid; flo uuid; result jsonb; days int;
BEGIN
  IF current_actor_kind()='FLO_LINK' OR p->>'purpose' NOT IN('AGREEMENT','COUNT') THEN
    SELECT destination_flo_id INTO flo FROM deliveries WHERE tenant_id=t AND id=subject;
    IF flo IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
    PERFORM assert_flo_scope(flo,subject,'evidence.submit');
  ELSIF p->>'purpose'='AGREEMENT' THEN PERFORM require_cap('agreement.upload');
    IF NOT EXISTS(SELECT 1 FROM flos WHERE tenant_id=t AND id=subject) THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  ELSE PERFORM require_cap('inventory.adjust.request');
    IF NOT EXISTS(SELECT 1 FROM inventory_batches WHERE tenant_id=t AND id=subject) THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  END IF;
  replay:=idem_begin(p_key,'register-media',p_hash); IF replay IS NOT NULL THEN RETURN replay; END IF;
  IF p->>'storage_key' IS DISTINCT FROM t::text||'/'||mid::text OR p->>'mime' NOT IN('image/jpeg','image/png','application/pdf')
    OR (p->>'bytes')::bigint NOT BETWEEN 1 AND 10485760 OR p_key IS NULL THEN PERFORM lb_raise('UPLOAD_INVALID'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(t::text),hashtext(p->>'sha256'));
  SELECT id INTO dup FROM media_files WHERE tenant_id=t AND sha256=p->>'sha256' AND deletion_state='ACTIVE' ORDER BY uploaded_at,id LIMIT 1;
  SELECT coalesce((v.body->>CASE WHEN p->>'purpose'='AGREEMENT' THEN 'agreement_retention_days' ELSE 'evidence_retention_days' END)::int,(v.body->>'media_retention_days')::int,90) INTO days FROM tenant_active_policies a JOIN policy_versions v ON v.tenant_id=a.tenant_id AND v.id=a.policy_version_id WHERE a.tenant_id=t AND a.kind='RETENTION';
  INSERT INTO media_files(id,tenant_id,storage_key,sha256,mime,bytes,uploader_actor,uploaded_at,sensitivity,purpose,retention_until,duplicate_of_media_id,subject_id,subject_type,created_by)
    VALUES(mid,t,p->>'storage_key',p->>'sha256',p->>'mime',(p->>'bytes')::bigint,current_user_id(),tenant_now(),'SENSITIVE',p->>'purpose',tenant_now()+make_interval(days=>coalesce(days,90)),dup,subject,'SCOPED',current_user_id());
  result:=jsonb_build_object('id',mid,'duplicate',dup IS NOT NULL);
  PERFORM append_audit('MEDIA_UPLOADED','MEDIA',mid,1,NULL,result); PERFORM idem_complete(p_key,result); RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.register_media(jsonb,text,text) TO lumbung_app;

-- Commands now own metadata and submission records. No raw media row can bypass guards.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT column_name FROM information_schema.column_privileges WHERE table_schema='lumbung' AND table_name='media_files'
    AND grantee='lumbung_app' AND privilege_type='INSERT' LOOP
    EXECUTE format('REVOKE INSERT (%I) ON media_files FROM lumbung_app',r.column_name);
  END LOOP;
END $$;
