SET LOCAL search_path = lumbung, pg_temp;

-- Run state-checked expiry handlers and finish their jobs in the same transaction.
-- A crash rolls the entire handler back. Due-ness uses the tenant clock.
CREATE FUNCTION lumbung.run_direct_due() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE t uuid:=require_ctx(); j jobs; a allocations; aid uuid; n int:=0;
BEGIN
  PERFORM require_cap('reservation.release');
  IF current_actor_kind() NOT IN('USER','WORKER') THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  FOR j IN SELECT * FROM jobs WHERE tenant_id=t AND kind IN('OFFER_EXPIRY','RESERVATION_EXPIRY')
      AND state IN('QUEUED','RETRY') AND run_at<=tenant_now() AND (next_attempt_at IS NULL OR next_attempt_at<=tenant_now())
      ORDER BY run_at,id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    BEGIN
    aid:=CASE WHEN j.kind='OFFER_EXPIRY' THEN (SELECT allocation_id FROM offers WHERE tenant_id=t AND id=j.subject_id) ELSE j.subject_id END;
    PERFORM 1 FROM donation_items i JOIN allocations aa ON aa.tenant_id=i.tenant_id AND aa.item_id=i.id
      WHERE aa.tenant_id=t AND aa.id=aid FOR UPDATE OF i;
    SELECT * INTO a FROM allocations WHERE tenant_id=t AND id=aid FOR UPDATE;
    IF a.source_type='DIRECT_ITEM' AND a.state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED')
        AND EXISTS(SELECT 1 FROM reservations WHERE tenant_id=t AND allocation_id=aid AND state='ACTIVE' AND expires_at<=tenant_now()) THEN
      PERFORM direct_release(aid,'DEADLINE_EXPIRED','EXPIRED');
      INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload)
        VALUES(t,'REMATCH_REQUIRED','ALLOCATION',aid,'MEDIUM','OPEN','rematch:'||aid,'{"fresh_outreach_approval_required":true}') ON CONFLICT DO NOTHING;
      PERFORM append_audit('RESERVATION_EXPIRED','ALLOCATION',aid,a.revision,'DEADLINE_EXPIRED');
    END IF;
    UPDATE jobs SET state='DONE',attempts=attempts+1,updated_at=tenant_now() WHERE tenant_id=t AND id=j.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE jobs SET attempts=attempts+1,state=CASE WHEN attempts+1>=max_attempts THEN 'DEAD' ELSE 'RETRY' END,
        last_error=SQLSTATE,error_category='HANDLER_FAILED',next_attempt_at=tenant_now()+make_interval(secs=>least(300,30*power(2,least(j.attempts,4))::int))
        WHERE tenant_id=t AND id=j.id;
      IF j.attempts+1>=j.max_attempts THEN
        INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload)
          VALUES(t,'JOB_TERMINAL_FAILURE',j.subject_type,j.subject_id,'HIGH','OPEN','dead-job:'||j.id,jsonb_build_object('job_id',j.id,'error_code',SQLSTATE)) ON CONFLICT DO NOTHING;
      END IF;
    END;
    n:=n+1;
  END LOOP;
  -- An unknown external send outcome never causes an automatic resend.
  WITH unknown AS (
    UPDATE outbox SET state='DELIVERY_UNKNOWN',last_error='LEASE_EXPIRED'
      WHERE tenant_id=t AND state='SENDING' AND lease_expires_at<=clock_timestamp() RETURNING id
  ) INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload)
    SELECT t,'SEND_RECONCILE','OUTBOX',id,'HIGH','OPEN','send-reconcile:'||id,'{}' FROM unknown ON CONFLICT DO NOTHING;
  UPDATE offers SET state='DELIVERY_UNKNOWN',r_eligible=false,r_exclusion='NO_DELIVERY_RECEIPT'
    WHERE tenant_id=t AND state IN('QUEUED','SENT') AND outbox_id IN(SELECT id FROM outbox WHERE tenant_id=t AND state='DELIVERY_UNKNOWN');
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.run_direct_due() TO lumbung_app;

CREATE FUNCTION lumbung.claim_direct_outbox(p_worker text,p_lease int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE t uuid:=require_ctx(); b outbox; ofr offers; a allocations; c outreach_campaigns; codes text[];
BEGIN
  PERFORM require_cap('message.send');
  IF current_actor_kind() NOT IN('USER','WORKER') OR length(p_worker) NOT BETWEEN 1 AND 200 OR p_lease NOT BETWEEN 1 AND 300 THEN
    PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=t AND mode IN('DEMO','TEST')) THEN PERFORM lb_raise('LIVE_SEND_BLOCKED'); END IF;
  SELECT * INTO b FROM outbox WHERE tenant_id=t AND state='PENDING' AND purpose='APPROVED_OFFER'
    AND (next_attempt_at IS NULL OR next_attempt_at<=tenant_now()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF b.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO ofr FROM offers WHERE tenant_id=t AND outbox_id=b.id;
  SELECT * INTO a FROM allocations WHERE tenant_id=t AND id=ofr.allocation_id;
  SELECT * INTO c FROM outreach_campaigns WHERE tenant_id=t AND id=ofr.campaign_id;
  IF b.conversation_id IS NOT NULL AND EXISTS(SELECT 1 FROM conversations WHERE tenant_id=t AND id=b.conversation_id AND human_owner_id IS NOT NULL) THEN
    UPDATE outbox SET state='HELD_TAKEOVER' WHERE tenant_id=t AND id=b.id; RETURN jsonb_build_object('skipped',true); END IF;
  codes:=direct_eligibility(a.item_id,a.flo_id,a.planned_receipt_at,a.planned_distribution_at);
  IF cardinality(codes)>0 OR b.expires_at<=tenant_now() OR ofr.state<>'QUEUED' OR c.state<>'RUNNING'
      OR NOT EXISTS(SELECT 1 FROM approvals WHERE tenant_id=t AND subject_id=c.id AND stage='OUTREACH' AND subject_revision=c.revision
        AND input_hash=c.plan_hash AND invalidated_at IS NULL AND expires_at>tenant_now()) THEN
    UPDATE outbox SET state='CANCELLED' WHERE tenant_id=t AND id=b.id;
    RETURN jsonb_build_object('skipped',true);
  END IF;
  IF NOT direct_window_open(a.flo_id,'CONTACT',tenant_now()) THEN RETURN NULL; END IF;
  UPDATE outbox SET state='SENDING',lease_owner=p_worker,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease),attempts=attempts+1
    WHERE tenant_id=t AND id=b.id;
  RETURN jsonb_build_object('id',b.id,'payload',b.payload,'mode',(SELECT mode FROM tenants WHERE id=t),
    'fault',(SELECT send_fault FROM simulation_settings WHERE tenant_id=t));
END $$;
GRANT EXECUTE ON FUNCTION lumbung.claim_direct_outbox(text,int) TO lumbung_app;

CREATE FUNCTION lumbung.finish_direct_outbox(p_id uuid,p_worker text,p_result text,p_provider_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE t uuid:=require_ctx(); b outbox;
BEGIN
  PERFORM require_cap('message.send');
  SELECT * INTO b FROM outbox WHERE tenant_id=t AND id=p_id FOR UPDATE;
  IF b.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF b.state<>'SENDING' OR b.lease_owner<>p_worker OR b.lease_expires_at<=clock_timestamp() THEN PERFORM lb_raise('INVALID_STATE'); END IF;
  IF p_result NOT IN('DELIVERED','SENT','DELIVERY_UNKNOWN','FAILED') THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  UPDATE outbox SET state=p_result,provider_message_id=p_provider_id WHERE tenant_id=t AND id=b.id;
  UPDATE offers SET state=CASE WHEN p_result='FAILED' THEN 'SEND_FAILED' ELSE p_result END,
    sent_at=CASE WHEN p_result IN('SENT','DELIVERED') THEN tenant_now() END,
    delivery_receipt_at=CASE WHEN p_result='DELIVERED' THEN tenant_now() END,
    response_deadline=CASE WHEN p_result IN('SENT','DELIVERED') THEN b.expires_at END,
    r_eligible=CASE WHEN p_result='DELIVERED' THEN NULL ELSE false END,
    r_exclusion=CASE WHEN p_result='DELIVERED' THEN NULL ELSE 'NO_DELIVERY_RECEIPT' END,revision=revision+1
    WHERE tenant_id=t AND outbox_id=b.id AND state='QUEUED';
  IF p_result IN('DELIVERY_UNKNOWN','FAILED') THEN
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload)
      VALUES(t,CASE WHEN p_result='FAILED' THEN 'CHANNEL_FAILURE' ELSE 'SEND_RECONCILE' END,'OUTBOX',b.id,'HIGH','OPEN',
        'send-reconcile:'||b.id,jsonb_build_object('outcome',p_result)) ON CONFLICT DO NOTHING;
  END IF;
  PERFORM emit_event('MOCK_SEND_'||p_result,'OUTBOX',b.id,1);
END $$;
GRANT EXECUTE ON FUNCTION lumbung.finish_direct_outbox(uuid,text,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.advance_direct_clock(p_minutes int,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE t uuid:=require_ctx(); result jsonb; replay jsonb;
BEGIN
  PERFORM require_cap('demo.clock');
  IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=t AND mode IN('DEMO','TEST') AND is_demo) THEN PERFORM lb_raise('DEMO_ONLY'); END IF;
  IF p_minutes NOT BETWEEN 1 AND 44640 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED','{"http":400}'); END IF;
  replay:=idem_begin(p_key,'advance-clock',canonical_hash(jsonb_build_object('minutes',p_minutes,'hash',p_hash)));
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  UPDATE tenant_clocks SET sim_anchor=tenant_now()+make_interval(mins=>p_minutes),real_anchor=now(),mode='FROZEN'
    WHERE tenant_id=t AND mode<>'REAL';
  IF NOT FOUND THEN PERFORM lb_raise('DEMO_ONLY'); END IF;
  result:=jsonb_build_object('now',tenant_now());
  PERFORM append_audit('CLOCK_ADVANCED','TENANT',t,NULL,NULL,result); PERFORM idem_complete(p_key,result); RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.advance_direct_clock(int,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.direct_worker_heartbeat(p_worker text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
BEGIN
  PERFORM require_ctx(); PERFORM require_cap('message.send');
  IF current_actor_kind()<>'WORKER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  INSERT INTO worker_heartbeats(worker_id,last_seen,version) VALUES(p_worker,clock_timestamp(),'direct-v1')
    ON CONFLICT(worker_id) DO UPDATE SET last_seen=excluded.last_seen,version=excluded.version;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.direct_worker_heartbeat(text) TO lumbung_app;

-- Source facts and snapshots now mutate only through audited, capability-checked
-- commands. Revoke the Stage 1 draft-writing column privileges too.
REVOKE INSERT,UPDATE ON allocation_runs,donation_items,donation_orders FROM lumbung_app;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT table_name,column_name FROM information_schema.column_privileges
    WHERE table_schema='lumbung' AND grantee='lumbung_app' AND privilege_type IN('INSERT','UPDATE')
      AND table_name IN('donation_items','donation_orders') LOOP
    EXECUTE format('REVOKE INSERT (%I),UPDATE (%I) ON lumbung.%I FROM lumbung_app',r.column_name,r.column_name,r.table_name);
  END LOOP;
END $$;
