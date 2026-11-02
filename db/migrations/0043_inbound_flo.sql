SET LOCAL search_path=lumbung,pg_temp;

CREATE FUNCTION lumbung.flo_link_view() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); l flo_access_links; result jsonb;
BEGIN
  PERFORM require_cap('evidence.submit');
  IF current_actor_kind()<>'FLO_LINK' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  SELECT * INTO l FROM flo_access_links WHERE tenant_id=t AND id=current_link_id();
  result:=jsonb_build_object('subject_type',l.subject_type,'subject_id',l.subject_id,'expires_at',l.expires_at,'now',tenant_now(),
    'flo_name',(SELECT name FROM flos WHERE tenant_id=t AND id=l.flo_id),'contact_id',l.contact_id,
    'offers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'code',o.code,'revision',o.revision,'state',o.state,'quantity',o.quantity::text,'unit',o.unit)) FROM offers o
      WHERE o.tenant_id=t AND l.subject_type='ALLOCATION' AND o.allocation_id=l.subject_id AND o.flo_id=l.flo_id),'[]'),
    'allocation',(SELECT jsonb_build_object('id',a.id,'revision',a.revision,'state',a.state,'quantity',a.quantity::text,'unit',a.unit) FROM allocations a
      WHERE a.tenant_id=t AND l.subject_type='ALLOCATION' AND a.id=l.subject_id AND a.flo_id=l.flo_id),
    'delivery',(SELECT jsonb_build_object('id',d.id,'code',d.code,'state',d.state,'revision',d.revision,'quantity',(SELECT sum(dispatched_qty)::text FROM delivery_lines WHERE tenant_id=t AND delivery_id=d.id),
      'unit',(SELECT unit FROM delivery_lines WHERE tenant_id=t AND delivery_id=d.id LIMIT 1)) FROM deliveries d WHERE d.tenant_id=t AND l.subject_type='DELIVERY' AND d.id=l.subject_id AND d.destination_flo_id=l.flo_id),
    'obligations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'type',o.type,'revision',o.revision,'state',o.state,'due_at',o.due_at,'subject_id',o.subject_id))
      FROM evidence_obligations o WHERE o.tenant_id=t AND l.subject_type='DELIVERY' AND obligation_delivery(o.id)=l.subject_id),'[]'),
    'receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'received_at',r.received_at,'lines',(SELECT jsonb_agg(jsonb_build_object('id',rl.id,'accepted_quantity',rl.accepted_qty::text,'unit',rl.unit,
      'remaining_quantity',(rl.accepted_qty-coalesce((SELECT sum(distributed_qty+loss_disposed_qty) FROM distribution_event_lines WHERE tenant_id=t AND receipt_line_id=rl.id),0))::text)) FROM receipt_lines rl WHERE rl.tenant_id=t AND rl.receipt_id=r.id AND rl.is_current)))
      FROM flo_receipts r WHERE r.tenant_id=t AND l.subject_type='DELIVERY' AND r.delivery_id=l.subject_id AND r.status='CURRENT'),'[]'));
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.flo_link_view() TO lumbung_app;

CREATE FUNCTION lumbung.flo_command(p_action text,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); l flo_access_links; result jsonb; replay jsonb; o offers;
BEGIN
  IF current_actor_kind()<>'FLO_LINK' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  SELECT * INTO l FROM flo_access_links WHERE tenant_id=t AND id=current_link_id();
  PERFORM assert_flo_scope(l.flo_id,l.subject_id,CASE p_action WHEN 'respond' THEN 'offer.respond' WHEN 'transport' THEN 'transport.edit' WHEN 'receive' THEN 'delivery.receive' ELSE 'evidence.submit' END);
  IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED'); END IF;
  replay:=idem_begin(p_key,'flo:'||p_action,p_hash); IF replay IS NOT NULL THEN RETURN replay; END IF;
  CASE p_action
    WHEN 'respond' THEN
      SELECT * INTO o FROM offers WHERE tenant_id=t AND id=(p->>'offer_id')::uuid AND flo_id=l.flo_id AND allocation_id=l.subject_id AND l.subject_type='ALLOCATION';
      IF o.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
      result:=direct_respond(o.id,p);
    WHEN 'transport' THEN
      IF l.subject_type<>'ALLOCATION' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
      result:=direct_transport(l.subject_id,p||jsonb_build_object('contact_id',l.contact_id));
    WHEN 'receive' THEN
      IF l.subject_type<>'DELIVERY' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
      result:=direct_receive(l.subject_id,p);
    ELSE PERFORM lb_raise('BAD_REQUEST');
  END CASE;
  PERFORM append_audit('FLO_'||upper(p_action),l.subject_type,l.subject_id,(result->>'revision')::int,NULL,jsonb_build_object('request',p,'result',result));
  PERFORM idem_complete(p_key,result); RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.flo_command(text,jsonb,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.ingest_mock_event(p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); cid uuid; eid uuid; replay jsonb; result jsonb;
BEGIN
  PERFORM require_cap('message.send');
  IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=t AND mode IN('DEMO','TEST')) THEN PERFORM lb_raise('LIVE_SEND_BLOCKED'); END IF;
  replay:=idem_begin(p_key,'ingest-mock',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
  IF length(coalesce(p->>'event_id','')) NOT BETWEEN 1 AND 200 OR length(coalesce(p->>'text','')) NOT BETWEEN 1 AND 6000 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  INSERT INTO webhook_events(tenant_id,provider,provider_account,event_id,payload,received_at)
    VALUES(t,'MOCK','demo',p->>'event_id',p,tenant_now()) ON CONFLICT(tenant_id,provider,provider_account,event_id) DO NOTHING RETURNING id INTO eid;
  IF eid IS NULL THEN SELECT id INTO eid FROM webhook_events WHERE tenant_id=t AND provider='MOCK' AND provider_account='demo' AND event_id=p->>'event_id'; END IF;
  INSERT INTO jobs(tenant_id,kind,subject_type,subject_id,dedup_key,run_at) VALUES(t,'PROCESS_INBOUND','WEBHOOK',eid,'inbound:'||eid,tenant_now()) ON CONFLICT DO NOTHING;
  result:=jsonb_build_object('id',eid,'state','RECEIVED');PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.ingest_mock_event(jsonb,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.process_mock_inbound(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); e webhook_events; contact flo_contacts; cid uuid; c conversations; o offers; n int; txt text; intent text:='UNKNOWN';
  aid uuid; result jsonb; run_id uuid; fault text; response_text text; v_outcome text:='CLARIFIED';
BEGIN
  PERFORM require_cap('message.send');
  SELECT * INTO e FROM webhook_events WHERE tenant_id=t AND id=p_id FOR UPDATE;
  IF e.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF e.state='PROCESSED' THEN RETURN jsonb_build_object('id',e.id,'state','PROCESSED'); END IF;
  SELECT * INTO contact FROM flo_contacts WHERE tenant_id=t AND id=(e.payload->>'contact_id')::uuid AND channel='SIM' AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL;
  IF contact.id IS NULL THEN
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'INBOUND_TRIAGE','WEBHOOK',e.id,'MEDIUM','inbound-triage:'||e.id,'{}') ON CONFLICT DO NOTHING;
    UPDATE webhook_events SET state='PROCESSED' WHERE tenant_id=t AND id=e.id;RETURN jsonb_build_object('state','TRIAGE');
  END IF;
  cid:=flo_conversation(contact.id);SELECT * INTO c FROM conversations WHERE tenant_id=t AND id=cid FOR UPDATE;txt:=lower(trim(e.payload->>'text'));
  SELECT llm_fault INTO fault FROM simulation_settings WHERE tenant_id=t;
  INSERT INTO agent_runs(tenant_id,kind,trigger,adapter,prompt_version,fallback_reason,tool_calls,outcome,redacted_log,correlation_id)
    VALUES(t,'INBOUND','MOCK','DETERMINISTIC','inbound-v1',CASE WHEN fault IS NOT NULL THEN 'MODEL_UNAVAILABLE' END,0,'RUNNING','{"untrusted_input":true}',current_correlation_id()) RETURNING id INTO run_id;
  IF txt ~ '(ignore|abaikan|reveal|system prompt|ubah.*stok|hapus.*perjanjian|bypass|grant|select .*from)' THEN
    intent:='REQUEST_HUMAN';response_text:='Permintaan ini perlu ditinjau staf. Izin dan aturan perjanjian tidak berubah.';v_outcome:='DENIED';
  ELSIF txt ~ '(human|manusia|staf|complaint|komplain)' THEN intent:='REQUEST_HUMAN';response_text:='Permintaan bantuan staf dicatat.';
  ELSIF c.agent_paused THEN intent:='HUMAN_OWNED';v_outcome:='PAUSED';
  ELSE
    SELECT count(*)::int INTO n FROM offers WHERE tenant_id=t AND contact_id=contact.id AND state IN('SENT','DELIVERED') AND expires_at>tenant_now()
      AND (e.payload->>'offer_code' IS NULL OR code=e.payload->>'offer_code');
    IF n=1 THEN
      SELECT * INTO o FROM offers WHERE tenant_id=t AND contact_id=contact.id AND state IN('SENT','DELIVERED') AND expires_at>tenant_now()
        AND (e.payload->>'offer_code' IS NULL OR code=e.payload->>'offer_code') ORDER BY id LIMIT 1;
      IF txt IN('yes','ya','terima','accept') THEN intent:='ACCEPT_OFFER';
      ELSIF txt IN('partial','sebagian') THEN intent:='PARTIAL_ACCEPT';
      ELSIF txt IN('no','tidak','tolak','decline') THEN intent:='DECLINE_OFFER';
      END IF;
      IF intent IN('ACCEPT_OFFER','PARTIAL_ACCEPT','DECLINE_OFFER') THEN
        result:=direct_respond(o.id,jsonb_build_object('expected_revision',o.revision,'response',CASE intent WHEN 'ACCEPT_OFFER' THEN 'ACCEPT' WHEN 'PARTIAL_ACCEPT' THEN 'PARTIAL_ACCEPT' ELSE 'DECLINE' END,
          'quantity',CASE WHEN intent='PARTIAL_ACCEPT' THEN e.payload->>'quantity' ELSE o.quantity::text END,'reason',coalesce(e.payload->>'reason','OTHER')));
        PERFORM refresh_direct_order((SELECT item_id FROM allocations WHERE tenant_id=t AND id=o.allocation_id));
        v_outcome:='APPLIED';response_text:='Respons untuk '||o.code||' dicatat. Pengiriman masih memerlukan konfirmasi logistik dan persetujuan staf.';
      END IF;
    END IF;
    IF response_text IS NULL THEN response_text:='Mohon cantumkan referensi penawaran/pengiriman dan tindakan yang dimaksud. Staf dapat membantu unggah atau pelaporan.'; END IF;
  END IF;
  INSERT INTO messages(tenant_id,conversation_id,direction,provider,provider_message_id,body,intent,parse,status,correlation_id)
    VALUES(t,cid,'IN','MOCK',e.event_id,e.payload->>'text',intent,jsonb_build_object('untrusted',true,'agent_run_id',run_id),'RECEIVED',current_correlation_id())
    ON CONFLICT(tenant_id,provider,provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING;
  IF intent='REQUEST_HUMAN' THEN
    UPDATE conversations SET agent_paused=true,paused_at=tenant_now(),revision=revision+1 WHERE tenant_id=t AND id=cid;
    UPDATE outbox SET state='HELD_TAKEOVER' WHERE tenant_id=t AND conversation_id=cid AND state='PENDING';
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'HUMAN_REQUESTED','CONVERSATION',cid,'HIGH','human:'||e.id,jsonb_build_object('outcome',v_outcome)) ON CONFLICT DO NOTHING;
  ELSIF NOT c.agent_paused THEN
    PERFORM queue_flo_message(contact.flo_id,e.id,response_text,'inbound-reply:'||e.id,'ASSISTANCE',tenant_now()+interval '1 day');
  END IF;
  UPDATE agent_runs SET outcome=v_outcome,tool_calls=CASE WHEN result IS NULL THEN 1 ELSE 3 END,
    redacted_log=jsonb_build_object('intent',intent,'result',result,'input_content_omitted',true) WHERE tenant_id=t AND id=run_id;
  INSERT INTO agent_tool_calls(tenant_id,run_id,seq,tool,args_hash,result_code)
    SELECT t,run_id,k,CASE k WHEN 1 THEN 'get_order_context' WHEN 2 THEN 'evaluate_eligibility' ELSE 'record_offer_response' END,
      canonical_hash(jsonb_build_object('event_id',e.id)),v_outcome FROM generate_series(1,CASE WHEN result IS NULL THEN 1 ELSE 3 END) k;
  UPDATE webhook_events SET state='PROCESSED',attempts=attempts+1 WHERE tenant_id=t AND id=e.id;
  UPDATE jobs SET state='DONE',attempts=attempts+1 WHERE tenant_id=t AND kind='PROCESS_INBOUND' AND subject_id=e.id AND state IN('QUEUED','RETRY');
  PERFORM append_audit('INBOUND_'||v_outcome,'WEBHOOK',e.id,NULL,NULL,jsonb_build_object('intent',intent,'result',result));
  RETURN jsonb_build_object('id',e.id,'state','PROCESSED','intent',intent,'outcome',v_outcome);
END $$;
GRANT EXECUTE ON FUNCTION lumbung.process_mock_inbound(uuid) TO lumbung_app;

ALTER TABLE agent_runs ADD CONSTRAINT agent_tool_budget CHECK(tool_calls<=8) NOT VALID;
CREATE FUNCTION lumbung.run_inbound_due() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); j jobs; n int:=0;
BEGIN
  PERFORM require_cap('message.send');
  FOR j IN SELECT * FROM jobs WHERE tenant_id=t AND kind='PROCESS_INBOUND' AND state IN('QUEUED','RETRY') AND run_at<=tenant_now()
    AND (next_attempt_at IS NULL OR next_attempt_at<=tenant_now()) ORDER BY run_at,id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    BEGIN PERFORM process_mock_inbound(j.subject_id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE jobs SET state=CASE WHEN attempts+1>=max_attempts THEN 'DEAD' ELSE 'RETRY' END,attempts=attempts+1,last_error=SQLSTATE,next_attempt_at=tenant_now()+interval '30 seconds' WHERE tenant_id=t AND id=j.id;
      IF j.attempts+1>=j.max_attempts THEN INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'JOB_TERMINAL_FAILURE','WEBHOOK',j.subject_id,'HIGH','dead-job:'||j.id,'{}') ON CONFLICT DO NOTHING;END IF;
    END;n:=n+1;
  END LOOP;RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.run_inbound_due() TO lumbung_app;
