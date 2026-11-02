SET LOCAL search_path=lumbung,pg_temp;

CREATE FUNCTION lumbung.flo_conversation(p_contact uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE cid uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(current_tenant()::text),hashtext(p_contact::text));
  SELECT id INTO cid FROM conversations WHERE tenant_id=current_tenant() AND flo_contact_id=p_contact AND state='OPEN' ORDER BY created_at,id LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO conversations(tenant_id,contact_kind,flo_contact_id,channel,provider,provider_account)
      VALUES(current_tenant(),'FLO',p_contact,'SIM','MOCK','demo') RETURNING id INTO cid;
  END IF;
  RETURN cid;
END $$;

CREATE FUNCTION lumbung.queue_flo_message(p_flo uuid,p_subject uuid,p_text text,p_dedupe text,p_purpose text,p_expires timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE contact uuid; cid uuid; bid uuid; paused boolean;
BEGIN
  SELECT id INTO contact FROM flo_contacts WHERE tenant_id=current_tenant() AND flo_id=p_flo AND channel='SIM'
    AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL ORDER BY id LIMIT 1;
  IF contact IS NULL THEN RETURN NULL; END IF;
  cid:=flo_conversation(contact); SELECT agent_paused INTO paused FROM conversations WHERE tenant_id=current_tenant() AND id=cid;
  INSERT INTO outbox(tenant_id,kind,dedupe_key,conversation_id,payload,purpose,locale,template,expires_at,state)
    VALUES(current_tenant(),'MESSAGE',p_dedupe,cid,jsonb_build_object('contact_id',contact,'subject_id',p_subject,'text',p_text),p_purpose,'id',p_purpose||'-ID-1',p_expires,
      CASE WHEN paused THEN 'HELD_TAKEOVER' ELSE 'PENDING' END) ON CONFLICT(tenant_id,dedupe_key) DO UPDATE SET dedupe_key=excluded.dedupe_key RETURNING id INTO bid;
  RETURN bid;
END $$;

CREATE FUNCTION lumbung.tg_link_outbox_conversation() RETURNS trigger
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
BEGIN
  IF current_actor_kind()<>'SYSTEM' AND current_tenant()=NEW.tenant_id AND NEW.kind='MESSAGE' AND NEW.payload->>'contact_id' IS NOT NULL AND NEW.conversation_id IS NULL THEN
    NEW.conversation_id:=flo_conversation((NEW.payload->>'contact_id')::uuid);
    IF EXISTS(SELECT 1 FROM conversations WHERE tenant_id=NEW.tenant_id AND id=NEW.conversation_id AND agent_paused) THEN NEW.state:='HELD_TAKEOVER'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER link_outbox_conversation BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION tg_link_outbox_conversation();

CREATE FUNCTION lumbung.tg_outbox_timeline() RETURNS trigger
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
BEGIN
  IF current_actor_kind()<>'SYSTEM' AND current_tenant()=NEW.tenant_id AND NEW.state IN('SENT','DELIVERED','DELIVERY_UNKNOWN','FAILED') AND OLD.state IS DISTINCT FROM NEW.state AND NEW.conversation_id IS NOT NULL THEN
    INSERT INTO messages(tenant_id,conversation_id,direction,provider,provider_message_id,reference_code,body,status,correlation_id)
      VALUES(NEW.tenant_id,NEW.conversation_id,'OUT','MOCK','outbox:'||NEW.id,coalesce(NEW.payload->>'offer_id',NEW.payload->>'subject_id'),NEW.payload->>'text',NEW.state,current_correlation_id())
      ON CONFLICT(tenant_id,provider,provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_timeline AFTER UPDATE ON outbox FOR EACH ROW EXECUTE FUNCTION tg_outbox_timeline();

CREATE FUNCTION lumbung.tg_schedule_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
BEGIN
  IF current_actor_kind()='SYSTEM' OR current_tenant() IS DISTINCT FROM NEW.tenant_id THEN RETURN NEW; END IF;
  INSERT INTO jobs(tenant_id,kind,subject_type,subject_id,dedup_key,payload,run_at)
    VALUES(NEW.tenant_id,'REPORT_REMINDER','OBLIGATION',NEW.id,'report:'||NEW.id||':before','{"stage":"BEFORE"}',greatest(NEW.anchor_at,NEW.due_at-interval '2 hours')),
      (NEW.tenant_id,'REPORT_REMINDER','OBLIGATION',NEW.id,'report:'||NEW.id||':after','{"stage":"AFTER"}',NEW.due_at+make_interval(mins=>coalesce((direct_policy('REPORTING')).body->>'bast_reminder_minutes','30')::int)),
      (NEW.tenant_id,'REPORT_ESCALATE','OBLIGATION',NEW.id,'report:'||NEW.id||':escalate','{}',NEW.due_at+interval '24 hours') ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER schedule_evidence AFTER INSERT ON evidence_obligations FOR EACH ROW EXECUTE FUNCTION tg_schedule_evidence();

CREATE FUNCTION lumbung.tg_delivery_followup() RETURNS trigger
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE planned_at timestamptz; deadline timestamptz;
BEGIN
  IF current_actor_kind()='SYSTEM' OR current_tenant() IS DISTINCT FROM NEW.tenant_id THEN RETURN NEW; END IF;
  IF OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL THEN
    SELECT min(a.planned_distribution_at),min(i.distribute_by) INTO planned_at,deadline FROM delivery_lines dl
      JOIN allocations a ON a.tenant_id=dl.tenant_id AND a.id=dl.allocation_id LEFT JOIN donation_items i ON i.tenant_id=dl.tenant_id AND i.id=dl.item_id
      WHERE dl.tenant_id=NEW.tenant_id AND dl.delivery_id=NEW.id;
    IF planned_at IS NOT NULL THEN
      INSERT INTO jobs(tenant_id,kind,subject_type,subject_id,dedup_key,run_at) VALUES
        (NEW.tenant_id,'DISTRIBUTION_FOLLOWUP','DELIVERY',NEW.id,'distribution-followup:'||NEW.id,planned_at),
        (NEW.tenant_id,'DISTRIBUTION_UNKNOWN','DELIVERY',NEW.id,'distribution-unknown:'||NEW.id,least(planned_at+interval '24 hours',deadline)) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  IF OLD.received_at IS NULL AND NEW.received_at IS NOT NULL AND EXISTS(SELECT 1 FROM evidence_obligations WHERE tenant_id=NEW.tenant_id AND subject_id=NEW.id AND type='RECEIPT_PHOTO' AND due_at<NEW.received_at) THEN
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(NEW.tenant_id,'DELIVERY_DELAY','DELIVERY',NEW.id,'HIGH','delivery-delay:'||NEW.id,'{"deadline_preserved":true}') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_followup AFTER UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION tg_delivery_followup();

CREATE FUNCTION lumbung.conversation_command(p_action text,p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); c conversations; replay jsonb; result jsonb;
BEGIN
  PERFORM require_cap(CASE WHEN p_action='send' THEN 'message.send' ELSE 'conversation.takeover' END);
  IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  SELECT * INTO c FROM conversations WHERE tenant_id=t AND id=p_id FOR UPDATE;
  IF c.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  replay:=idem_begin(p_key,'conversation:'||p_action,p_hash); IF replay IS NOT NULL THEN RETURN replay; END IF;
  IF c.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  CASE p_action
    WHEN 'takeover' THEN
      UPDATE conversations SET human_owner_id=current_user_id(),agent_paused=true,paused_at=tenant_now(),revision=revision+1 WHERE tenant_id=t AND id=c.id;
      UPDATE outbox SET state='HELD_TAKEOVER' WHERE tenant_id=t AND conversation_id=c.id AND state='PENDING';
      -- Already claimed outcomes need reconciliation rather than a second send.
      WITH unknown AS(UPDATE outbox SET state='DELIVERY_UNKNOWN' WHERE tenant_id=t AND conversation_id=c.id AND state='SENDING' RETURNING id)
        INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
          SELECT t,'SEND_RECONCILE','OUTBOX',id,'HIGH','send-reconcile:'||id,'{}' FROM unknown ON CONFLICT DO NOTHING;
    WHEN 'resume' THEN
      IF length(trim(coalesce(p->>'summary','')))<10 THEN PERFORM lb_raise('CONTEXT_SUMMARY_REQUIRED'); END IF;
      UPDATE conversations SET human_owner_id=NULL,agent_paused=false,paused_at=NULL,resume_summary=p->>'summary',revision=revision+1 WHERE tenant_id=t AND id=c.id;
      UPDATE outbox SET state=CASE WHEN expires_at<=tenant_now() THEN 'CANCELLED' ELSE 'PENDING' END WHERE tenant_id=t AND conversation_id=c.id AND state='HELD_TAKEOVER';
    WHEN 'send' THEN
      IF c.human_owner_id IS DISTINCT FROM current_user_id() OR length(trim(coalesce(p->>'text','')))<1 THEN PERFORM lb_raise('CONVERSATION_PAUSED'); END IF;
      INSERT INTO outbox(tenant_id,kind,dedupe_key,conversation_id,payload,purpose,locale,template)
        VALUES(t,'MESSAGE','operator:'||p_key,c.id,jsonb_build_object('contact_id',c.flo_contact_id,'text',p->>'text','operator',true),'OPERATOR','id','OPERATOR-ID-1');
    ELSE PERFORM lb_raise('BAD_REQUEST');
  END CASE;
  SELECT jsonb_build_object('id',id,'revision',revision,'agent_paused',agent_paused) INTO result FROM conversations WHERE tenant_id=t AND id=c.id;
  PERFORM append_audit('CONVERSATION_'||upper(p_action),'CONVERSATION',c.id,(result->>'revision')::int,p->>'summary',result);
  PERFORM idem_complete(p_key,result); RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.conversation_command(text,uuid,jsonb,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.claim_any_outbox(p_worker text,p_lease int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); result jsonb; b outbox; contact flo_contacts;
BEGIN
  PERFORM require_cap('message.send');
  UPDATE outbox ob SET state='HELD_TAKEOVER' WHERE ob.tenant_id=t AND ob.state='PENDING' AND ob.purpose<>'OPERATOR'
    AND EXISTS(SELECT 1 FROM conversations c WHERE c.tenant_id=t AND c.id=ob.conversation_id AND c.agent_paused);
  result:=claim_direct_outbox(p_worker,p_lease); IF result IS NOT NULL THEN RETURN result; END IF;
  IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=t AND mode IN('DEMO','TEST')) THEN PERFORM lb_raise('LIVE_SEND_BLOCKED'); END IF;
  SELECT * INTO b FROM outbox WHERE tenant_id=t AND state='PENDING' AND purpose IN('REPORTING','ASSISTANCE','OPERATOR')
    AND (next_attempt_at IS NULL OR next_attempt_at<=tenant_now()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF b.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO contact FROM flo_contacts WHERE tenant_id=t AND id=(b.payload->>'contact_id')::uuid AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL;
  IF contact.id IS NULL OR b.expires_at<=tenant_now() THEN UPDATE outbox SET state='CANCELLED' WHERE tenant_id=t AND id=b.id;RETURN jsonb_build_object('skipped',true);END IF;
  IF NOT direct_window_open(contact.flo_id,'CONTACT',tenant_now()) THEN RETURN NULL; END IF;
  UPDATE outbox SET state='SENDING',lease_owner=p_worker,lease_expires_at=clock_timestamp()+make_interval(secs=>least(300,greatest(1,p_lease))),attempts=attempts+1 WHERE tenant_id=t AND id=b.id;
  RETURN jsonb_build_object('id',b.id,'payload',b.payload,'mode',(SELECT mode FROM tenants WHERE id=t),'fault',(SELECT send_fault FROM simulation_settings WHERE tenant_id=t));
END $$;
GRANT EXECUTE ON FUNCTION lumbung.claim_any_outbox(text,int) TO lumbung_app;

CREATE FUNCTION lumbung.run_reporting_due() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); j jobs; o evidence_obligations; flo uuid; n int:=0; d deliveries;
BEGIN
  PERFORM require_cap('message.send');
  FOR j IN SELECT * FROM jobs WHERE tenant_id=t AND kind IN('REPORT_REMINDER','REPORT_ESCALATE','DISTRIBUTION_FOLLOWUP','DISTRIBUTION_UNKNOWN')
    AND state IN('QUEUED','RETRY') AND run_at<=tenant_now() AND (next_attempt_at IS NULL OR next_attempt_at<=tenant_now()) ORDER BY run_at,id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      IF j.subject_type='OBLIGATION' THEN
        SELECT * INTO o FROM evidence_obligations WHERE tenant_id=t AND id=j.subject_id FOR UPDATE;
        IF o.state IN('OPEN','NEEDS_CLARIFICATION','REJECTED_FINAL') THEN
          flo:=obligation_flo(o.id);
          IF j.kind='REPORT_REMINDER' THEN
            PERFORM queue_flo_message(flo,o.id,'Bu/Pak, laporan '||o.type||' untuk '||obligation_delivery(o.id)||' belum lengkap. Batas WIB: '||(o.due_at AT TIME ZONE o.timezone)::text||'. Mohon foto yang tidak memperlihatkan identitas penerima atau penjelasan bantuan staf.',
              'report-reminder:'||o.id||':'||(tenant_now() AT TIME ZONE o.timezone)::date,'REPORTING');
          ELSE
            INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
              VALUES(t,'EVIDENCE_OVERDUE','OBLIGATION',o.id,'HIGH','evidence-overdue:'||o.id,jsonb_build_object('delivery_id',obligation_delivery(o.id))) ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      ELSE
        SELECT * INTO d FROM deliveries WHERE tenant_id=t AND id=CASE WHEN j.subject_type='FLO_RECEIPT' THEN (SELECT delivery_id FROM flo_receipts WHERE tenant_id=t AND id=j.subject_id) ELSE j.subject_id END;
        IF d.state IN('RECEIVED','PARTIALLY_RECEIVED') AND NOT EXISTS(SELECT 1 FROM distribution_events e JOIN flo_receipts r ON r.tenant_id=e.tenant_id AND r.id=e.receipt_id WHERE e.tenant_id=t AND r.delivery_id=d.id AND NOT e.planned) THEN
          IF j.kind='DISTRIBUTION_FOLLOWUP' THEN
            INSERT INTO jobs(tenant_id,kind,subject_type,subject_id,dedup_key,run_at) VALUES(t,'DISTRIBUTION_UNKNOWN','DELIVERY',d.id,'distribution-unknown:'||d.id,j.run_at+interval '24 hours') ON CONFLICT DO NOTHING;
            PERFORM queue_flo_message(d.destination_flo_id,d.id,'Bu/Pak, apakah pembagian untuk '||d.code||' sudah dilakukan? Mohon tanggal, jumlah, sisa dan laporan kegiatan. Konsumsi tetap belum diketahui sampai dilaporkan.', 'distribution-followup:'||d.id,'REPORTING');
          ELSE INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
            VALUES(t,'DISTRIBUTION_STATUS_UNKNOWN','DELIVERY',d.id,'HIGH','distribution-unknown:'||d.id,'{"consumption":"UNKNOWN"}') ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
      UPDATE jobs SET state='DONE',attempts=attempts+1 WHERE tenant_id=t AND id=j.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE jobs SET state=CASE WHEN attempts+1>=max_attempts THEN 'DEAD' ELSE 'RETRY' END,attempts=attempts+1,last_error=SQLSTATE,next_attempt_at=tenant_now()+interval '2 minutes' WHERE tenant_id=t AND id=j.id;
      IF j.attempts+1>=j.max_attempts THEN INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'JOB_TERMINAL_FAILURE',j.subject_type,j.subject_id,'HIGH','dead-job:'||j.id,jsonb_build_object('job_id',j.id)) ON CONFLICT DO NOTHING;END IF;
    END;
    n:=n+1;
  END LOOP;
  UPDATE media_files SET deletion_state='DELETED' WHERE tenant_id=t AND deletion_state='ACTIVE' AND retention_until<tenant_now();
  INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
    SELECT t,'AGREEMENT_RENEWAL','AGREEMENT',r.agreement_id,'MEDIUM','renewal:'||r.id,jsonb_build_object('renewal_task_id',r.id)
    FROM renewal_tasks r WHERE r.tenant_id=t AND r.status='OPEN' AND r.due_at<=tenant_now() ON CONFLICT DO NOTHING;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.run_reporting_due() TO lumbung_app;
