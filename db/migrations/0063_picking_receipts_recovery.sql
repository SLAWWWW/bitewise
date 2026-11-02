SET LOCAL search_path=lumbung,pg_temp;
ALTER TABLE delivery_lines ADD COLUMN cancelled boolean NOT NULL DEFAULT false;

CREATE FUNCTION lumbung.pick_delivery(p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); pl pick_lists; line jsonb; l pick_lines; old_batch inventory_batches; new_batch inventory_batches; a allocations;
  qty numeric; changed_qty boolean:=false; changed_batch boolean:=false; total numeric; replay jsonb; result jsonb; before_facts jsonb;
BEGIN
 PERFORM require_cap('inventory.pick');IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 replay:=idem_begin(p_key,'pick-delivery',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 SELECT * INTO pl FROM pick_lists WHERE tenant_id=t AND delivery_id=p_id ORDER BY id LIMIT 1 FOR UPDATE;IF pl.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 IF pl.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
 IF pl.state<>'OPEN' THEN PERFORM lb_raise('INVALID_STATE');END IF;
 IF jsonb_array_length(p->'lines')<>(SELECT count(*) FROM pick_lines WHERE tenant_id=t AND pick_list_id=pl.id) THEN PERFORM lb_raise('BAD_REQUEST');END IF;
 SELECT jsonb_agg(to_jsonb(x)) INTO before_facts FROM pick_lines x WHERE tenant_id=t AND pick_list_id=pl.id;
 FOR line IN SELECT * FROM jsonb_array_elements(p->'lines') LOOP
   SELECT * INTO l FROM pick_lines WHERE tenant_id=t AND pick_list_id=pl.id AND id=(line->>'pick_line_id')::uuid FOR UPDATE;
   IF l.id IS NULL OR l.picked_qty IS NOT NULL THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   SELECT a0.* INTO a FROM allocations a0 JOIN reservations r ON r.tenant_id=a0.tenant_id AND r.allocation_id=a0.id JOIN reservation_lines rl ON rl.tenant_id=r.tenant_id AND rl.reservation_id=r.id
     WHERE rl.tenant_id=t AND rl.id=l.reservation_line_id FOR UPDATE OF a0;
   IF a.state<>'APPROVED' THEN PERFORM lb_raise('DISPATCH_APPROVAL_REQUIRED');END IF;
   SELECT * INTO old_batch FROM inventory_batches WHERE tenant_id=t AND id=l.batch_id FOR UPDATE;
   qty:=(line->>'picked_quantity')::numeric;
   IF qty IS NULL OR qty<0 OR qty>l.planned_qty OR qty<>round(qty,3) OR (old_batch.unit_kind='COUNT' AND qty<>trunc(qty)) THEN PERFORM lb_raise('QTY_INCREMENT_VIOLATION');END IF;
   IF line->>'substitute_batch_id' IS NOT NULL AND (line->>'substitute_batch_id')::uuid<>l.batch_id THEN
     SELECT * INTO new_batch FROM inventory_batches WHERE tenant_id=t AND id=(line->>'substitute_batch_id')::uuid FOR UPDATE;
     IF new_batch.id IS NULL OR new_batch.product_id<>old_batch.product_id OR new_batch.base_unit<>old_batch.base_unit OR NOT batch_is_usable(new_batch.id,a.planned_distribution_at)
       OR length(trim(coalesce(line->>'reason','')))<3 OR NOT EXISTS(SELECT 1 FROM storage_locations x JOIN storage_locations y ON y.tenant_id=x.tenant_id AND y.warehouse_id=x.warehouse_id WHERE x.tenant_id=t AND x.id=old_batch.storage_location_id AND y.id=new_batch.storage_location_id) THEN PERFORM lb_raise('SUBSTITUTION_INVALID');END IF;
     PERFORM post_stock_transfer(old_batch.id,'RESERVED','AVAILABLE',l.planned_qty,'RESERVATION_RELEASE',p_key||':sub-release:'||l.id,line->>'reason');
     IF qty>0 THEN PERFORM post_stock_transfer(new_batch.id,'AVAILABLE','RESERVED',qty,'RESERVATION_TRANSFER',p_key||':sub-reserve:'||l.id,line->>'reason');END IF;
     UPDATE reservation_lines SET batch_id=new_batch.id WHERE tenant_id=t AND id=l.reservation_line_id;
     UPDATE delivery_lines SET batch_id=new_batch.id WHERE tenant_id=t AND delivery_id=pl.delivery_id AND allocation_id=a.id AND batch_id=l.batch_id;
     UPDATE pick_lines SET batch_id=new_batch.id,substitution_note=line->>'reason' WHERE tenant_id=t AND id=l.id;changed_batch:=true;
   ELSE
     IF NOT batch_is_usable(old_batch.id,a.planned_distribution_at) THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED');END IF;
     IF qty<l.planned_qty THEN PERFORM post_stock_transfer(old_batch.id,'RESERVED','AVAILABLE',l.planned_qty-qty,'RESERVATION_RELEASE',p_key||':short:'||l.id,'SHORT_PICK');END IF;
     new_batch:=old_batch;
   END IF;
   IF qty<l.planned_qty THEN changed_qty:=true;END IF;
   UPDATE reservation_lines SET state=CASE WHEN qty=0 THEN 'RELEASED' ELSE 'ACTIVE' END,quantity=CASE WHEN qty=0 THEN quantity ELSE qty END WHERE tenant_id=t AND id=l.reservation_line_id;
   UPDATE delivery_lines SET cancelled=qty=0,allocated_qty=CASE WHEN qty=0 THEN allocated_qty ELSE qty END,picked_qty=qty WHERE tenant_id=t AND delivery_id=pl.delivery_id AND allocation_id=a.id AND batch_id=new_batch.id;
   UPDATE pick_lines SET picked_qty=qty WHERE tenant_id=t AND id=l.id;
 END LOOP;
 SELECT coalesce(sum(picked_qty),0) INTO total FROM pick_lines WHERE tenant_id=t AND pick_list_id=pl.id;
 IF total=0 THEN
   PERFORM direct_release(a.id,'EMPTY_PICK');UPDATE deliveries SET state='CANCELLED',revision=revision+1 WHERE tenant_id=t AND id=p_id;
 ELSE
   IF changed_qty OR changed_batch THEN
     UPDATE allocations SET quantity=total,state=CASE WHEN changed_qty THEN 'LOGISTICS_PENDING' ELSE 'AWAITING_FINAL_APPROVAL' END,revision=revision+1 WHERE tenant_id=t AND id=a.id;
     UPDATE approvals SET invalidated_at=tenant_now(),invalidated_reason='PICK_CHANGED' WHERE tenant_id=t AND subject_id=a.id AND stage='FINAL_DISPATCH' AND invalidated_at IS NULL;
     INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'APPROVAL_INVALIDATED','ALLOCATION',a.id,'HIGH','pick-changed:'||pl.id,jsonb_build_object('reconfirm_quantity',changed_qty,'quantity',total::text)) ON CONFLICT DO NOTHING;
   END IF;
   UPDATE deliveries SET revision=revision+1 WHERE tenant_id=t AND id=p_id;
 END IF;
 UPDATE pick_lists SET state=CASE WHEN total=0 THEN 'CANCELLED' ELSE 'PICKED' END,picker_id=current_user_id(),picked_at=tenant_now(),revision=revision+1 WHERE tenant_id=t AND id=pl.id;
 result:=jsonb_build_object('id',pl.id,'delivery_id',p_id,'revision',pl.revision+1,'state',CASE WHEN total=0 THEN 'CANCELLED' ELSE 'PICKED' END,'approval_invalidated',changed_qty OR changed_batch);
 PERFORM append_audit('DELIVERY_PICKED','DELIVERY',p_id,NULL,p->>'reason',jsonb_build_object('request',p,'before',before_facts,'result',result),before_facts,result);PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.pick_delivery(uuid,jsonb,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.receive_batch_delivery(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=current_tenant(); d deliveries; dl delivery_lines; accepted numeric; rejected numeric; total numeric; take numeric; refuse numeric; rid uuid; pol policy_versions; tz text;
BEGIN
 SELECT * INTO d FROM deliveries WHERE tenant_id=t AND id=p_id FOR UPDATE;IF d.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 IF d.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
 IF d.state<>'IN_TRANSIT' THEN PERFORM lb_raise('INVALID_STATE');END IF;
 accepted:=(p->>'accepted_quantity')::numeric;rejected:=(p->>'rejected_quantity')::numeric;
 SELECT sum(dispatched_qty) INTO total FROM delivery_lines WHERE tenant_id=t AND delivery_id=d.id AND NOT cancelled;
 IF accepted IS NULL OR rejected IS NULL OR least(accepted,rejected)<0 OR accepted+rejected>total OR accepted<>round(accepted,3) OR rejected<>round(rejected,3)
   OR EXISTS(SELECT 1 FROM delivery_lines WHERE tenant_id=t AND delivery_id=d.id AND unit_kind='COUNT' AND (accepted<>trunc(accepted) OR rejected<>trunc(rejected))) THEN PERFORM lb_raise('RECEIPT_EXCEEDS_DISPATCHED');END IF;
 IF accepted<total AND length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
 INSERT INTO flo_receipts(tenant_id,delivery_id,flo_id,received_at,time_source,recorded_by_actor,created_by) VALUES(t,d.id,d.destination_flo_id,tenant_now(),'FLO_REPORTED',current_user_id(),current_user_id()) RETURNING id INTO rid;
 FOR dl IN SELECT dl0.* FROM delivery_lines dl0 JOIN inventory_batches b ON b.tenant_id=dl0.tenant_id AND b.id=dl0.batch_id WHERE dl0.tenant_id=t AND dl0.delivery_id=d.id AND NOT dl0.cancelled ORDER BY least(b.expires_at,b.handling_deadline),b.received_at,b.id LOOP
   take:=least(accepted,dl.dispatched_qty);refuse:=least(rejected,dl.dispatched_qty-take);
   IF take>0 THEN PERFORM post_stock_transfer(dl.batch_id,'IN_TRANSIT','DELIVERED',take,'DELIVERY_RECEIPT','receipt:'||rid||':'||dl.id||':accepted','FLO_RECEIPT');END IF;
   IF dl.dispatched_qty>take THEN PERFORM post_stock_transfer(dl.batch_id,'IN_TRANSIT','EXCEPTION',dl.dispatched_qty-take,'DELIVERY_RECEIPT','receipt:'||rid||':'||dl.id||':exception',p->>'reason');END IF;
   INSERT INTO receipt_lines(tenant_id,receipt_id,delivery_line_id,flo_id,category_id,unit,received_at,accepted_qty,rejected_qty,discrepancy_reason)
     VALUES(t,rid,dl.id,d.destination_flo_id,dl.category_id,dl.unit,tenant_now(),take,refuse,p->>'reason');
   accepted:=accepted-take;rejected:=rejected-refuse;
   UPDATE allocations SET state='RECEIVED' WHERE tenant_id=t AND id=dl.allocation_id;
 END LOOP;
 UPDATE deliveries SET state=CASE WHEN (p->>'accepted_quantity')::numeric=total THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END,received_at=tenant_now(),arrived_at=tenant_now(),custodian='FLO',revision=revision+1 WHERE tenant_id=t AND id=d.id RETURNING * INTO d;
 IF d.state='PARTIALLY_RECEIVED' THEN INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'RECEIPT_DISCREPANCY','DELIVERY',d.id,'HIGH','receipt-discrepancy:'||d.id,p) ON CONFLICT DO NOTHING;END IF;
 IF agreement_valid_at(d.destination_flo_id,tenant_now()) IS NULL THEN INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'AGREEMENT_EXPIRED_AT_HANDOVER','DELIVERY',d.id,'HIGH','agreement-handover:'||d.id,'{}') ON CONFLICT DO NOTHING;END IF;
 pol:=direct_policy('REPORTING');SELECT timezone INTO tz FROM tenants WHERE id=t;
 INSERT INTO evidence_obligations(tenant_id,type,subject_type,subject_id,anchor_kind,anchor_at,due_at,due_rule,timezone,policy_version_id) VALUES(t,'BAST','DELIVERY',d.id,'RECEIPT',tenant_now(),tenant_now(),'AT_RECEIPT',tz,pol.id);
 RETURN jsonb_build_object('id',d.id,'revision',d.revision,'state',d.state,'receipt_id',rid);
END $$;
ALTER FUNCTION lumbung.direct_receive(uuid,jsonb) RENAME TO receive_direct_delivery;
CREATE FUNCTION lumbung.direct_receive(p_id uuid,p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM deliveries WHERE tenant_id=current_tenant() AND id=p_id AND route='WAREHOUSE_OUTBOUND') THEN RETURN receive_batch_delivery(p_id,p);END IF;
 RETURN receive_direct_delivery(p_id,p);
END $$;

ALTER FUNCTION lumbung.claim_direct_outbox(text,int) RENAME TO claim_direct_outbox_legacy;
REVOKE EXECUTE ON FUNCTION lumbung.claim_direct_outbox_legacy(text,int) FROM lumbung_app;
CREATE FUNCTION lumbung.claim_direct_outbox(p_worker text,p_lease int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); b outbox; a allocations; c outreach_campaigns; codes text[];
BEGIN
 PERFORM require_cap('message.send');
 SELECT ob.* INTO b FROM outbox ob JOIN offers o ON o.tenant_id=ob.tenant_id AND o.outbox_id=ob.id JOIN allocations aa ON aa.tenant_id=o.tenant_id AND aa.id=o.allocation_id
   WHERE ob.tenant_id=t AND ob.state='PENDING' AND ob.purpose='APPROVED_OFFER' AND aa.source_type='BATCH' ORDER BY ob.created_at,ob.id LIMIT 1 FOR UPDATE OF ob SKIP LOCKED;
 IF b.id IS NULL THEN RETURN claim_direct_outbox_legacy(p_worker,p_lease);END IF;
 IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=t AND mode IN('DEMO','TEST')) THEN PERFORM lb_raise('LIVE_SEND_BLOCKED');END IF;
 SELECT aa.* INTO a FROM allocations aa JOIN offers o ON o.tenant_id=aa.tenant_id AND o.allocation_id=aa.id WHERE o.tenant_id=t AND o.outbox_id=b.id;
 SELECT * INTO c FROM outreach_campaigns WHERE tenant_id=t AND id=a.campaign_id;
 codes:=batch_eligibility(a.release_plan_id,a.flo_id,a.planned_receipt_at,a.planned_distribution_at);
 IF cardinality(codes)>0 OR b.expires_at<=tenant_now() OR c.state<>'RUNNING' OR NOT EXISTS(SELECT 1 FROM approvals WHERE tenant_id=t AND subject_id=c.id AND stage='OUTREACH' AND input_hash=c.plan_hash AND subject_revision=c.revision AND invalidated_at IS NULL AND expires_at>tenant_now()) THEN
   UPDATE outbox SET state='CANCELLED' WHERE tenant_id=t AND id=b.id;RETURN jsonb_build_object('skipped',true);END IF;
 IF EXISTS(SELECT 1 FROM conversations WHERE tenant_id=t AND id=b.conversation_id AND agent_paused) THEN UPDATE outbox SET state='HELD_TAKEOVER' WHERE tenant_id=t AND id=b.id;RETURN jsonb_build_object('skipped',true);END IF;
 IF NOT direct_window_open(a.flo_id,'CONTACT',tenant_now()) THEN RETURN NULL;END IF;
 UPDATE outbox SET state='SENDING',lease_owner=p_worker,lease_expires_at=clock_timestamp()+make_interval(secs=>least(300,greatest(1,p_lease))),attempts=attempts+1 WHERE tenant_id=t AND id=b.id;
 RETURN jsonb_build_object('id',b.id,'payload',b.payload,'mode',(SELECT mode FROM tenants WHERE id=t),'fault',(SELECT send_fault FROM simulation_settings WHERE tenant_id=t));
END $$;
GRANT EXECUTE ON FUNCTION lumbung.claim_direct_outbox(text,int) TO lumbung_app;

ALTER FUNCTION lumbung.on_agreement_revoked(uuid,uuid,text) RENAME TO on_direct_agreement_revoked;
CREATE FUNCTION lumbung.on_agreement_revoked(p_agreement uuid,p_flo uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE a record; n int:=0; previous jsonb;
BEGIN
 previous:=on_direct_agreement_revoked(p_agreement,p_flo,p_reason);
 FOR a IN SELECT id FROM allocations WHERE tenant_id=current_tenant() AND flo_id=p_flo AND source_type='BATCH' AND state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED') ORDER BY id LOOP
   PERFORM direct_release(a.id,'AGREEMENT_REVOKED','EXCEPTION');n:=n+1;
   INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(current_tenant(),'AGREEMENT_REVOKED_ACTIVE_COMMITMENT','ALLOCATION',a.id,'HIGH','revoked:'||a.id||':'||p_agreement,jsonb_build_object('agreement_id',p_agreement,'reason',p_reason)) ON CONFLICT DO NOTHING;
 END LOOP;RETURN jsonb_build_object('affected_allocations',coalesce((previous->>'affected_allocations')::int,0)+n);
END $$;

CREATE FUNCTION lumbung.run_inventory_due() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); j jobs; a allocations; n int:=0;
BEGIN
 PERFORM require_cap('reservation.release');
 FOR j IN SELECT * FROM jobs WHERE tenant_id=t AND kind IN('BATCH_OFFER_EXPIRY','BATCH_RESERVATION_EXPIRY') AND state IN('QUEUED','RETRY') AND run_at<=tenant_now() AND (next_attempt_at IS NULL OR next_attempt_at<=tenant_now()) ORDER BY run_at,id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  BEGIN
   SELECT * INTO a FROM allocations WHERE tenant_id=t AND id=j.subject_id FOR UPDATE;
   IF a.state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED') AND EXISTS(SELECT 1 FROM reservations WHERE tenant_id=t AND allocation_id=a.id AND state='ACTIVE' AND expires_at<=tenant_now()) THEN
     PERFORM direct_release(a.id,'DEADLINE_EXPIRED','EXPIRED');INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'REMATCH_REQUIRED','ALLOCATION',a.id,'MEDIUM','rematch:'||a.id,'{}') ON CONFLICT DO NOTHING;
   END IF;
   UPDATE jobs SET state='DONE',attempts=attempts+1 WHERE tenant_id=t AND id=j.id;
  EXCEPTION WHEN OTHERS THEN
   UPDATE jobs SET state=CASE WHEN attempts+1>=max_attempts THEN 'DEAD' ELSE 'RETRY' END,attempts=attempts+1,last_error=SQLSTATE,next_attempt_at=tenant_now()+interval '2 minutes' WHERE tenant_id=t AND id=j.id;
   IF j.attempts+1>=j.max_attempts THEN INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'JOB_TERMINAL_FAILURE',j.subject_type,j.subject_id,'HIGH','dead-job:'||j.id,jsonb_build_object('job_id',j.id)) ON CONFLICT DO NOTHING;END IF;
  END;
  n:=n+1;
 END LOOP;
 INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
   SELECT t,'BALANCE_MISMATCH','BATCH',bb.batch_id,'CRITICAL','balance-mismatch:'||bb.batch_id,jsonb_build_object('account',bb.account)
   FROM batch_balances bb WHERE bb.tenant_id=t AND bb.qty IS DISTINCT FROM coalesce((SELECT sum(signed_qty) FROM movement_entries WHERE tenant_id=t AND batch_id=bb.batch_id AND account=bb.account),0) ON CONFLICT DO NOTHING;
 INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
   SELECT t,'BATCH_EXPIRED','BATCH',b.id,'HIGH','batch-expired:'||b.id,'{}' FROM inventory_batches b WHERE b.tenant_id=t AND least(b.expires_at,b.handling_deadline)<=tenant_now()
     AND EXISTS(SELECT 1 FROM batch_balances WHERE tenant_id=t AND batch_id=b.id AND account IN('AVAILABLE','RESERVED') AND qty>0) ON CONFLICT DO NOTHING;
 FOR a IN SELECT al.* FROM allocations al WHERE al.tenant_id=t AND al.source_type='BATCH' AND al.state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED')
  AND EXISTS(SELECT 1 FROM reservations r JOIN reservation_lines l ON l.tenant_id=r.tenant_id AND l.reservation_id=r.id WHERE r.tenant_id=t AND r.allocation_id=al.id AND l.state='ACTIVE' AND NOT batch_is_usable(l.batch_id,al.planned_distribution_at)) ORDER BY al.id LOOP
   PERFORM direct_release(a.id,'STOCK_INVALID','EXCEPTION');
   INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'STOCK_REVIEW','ALLOCATION',a.id,'HIGH','stock-review:'||a.id,'{}') ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.run_inventory_due() TO lumbung_app;

CREATE FUNCTION lumbung.workflow_command(p_action text,p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); source text;
BEGIN
 CASE p_action
   WHEN 'draft' THEN SELECT CASE WHEN release_plan_id IS NULL THEN 'DIRECT_ITEM' ELSE 'BATCH' END INTO source FROM allocation_runs WHERE tenant_id=t AND id=p_id;
   WHEN 'approve-outreach','start' THEN SELECT source_type INTO source FROM outreach_campaigns WHERE tenant_id=t AND id=p_id;
   WHEN 'respond' THEN SELECT a.source_type INTO source FROM offers o JOIN allocations a ON a.tenant_id=o.tenant_id AND a.id=o.allocation_id WHERE o.tenant_id=t AND o.id=p_id;
   WHEN 'transport','approve-dispatch','release' THEN SELECT source_type INTO source FROM allocations WHERE tenant_id=t AND id=p_id;
   WHEN 'dispatch','receive' THEN SELECT CASE WHEN route='DIRECT' THEN 'DIRECT_ITEM' ELSE 'BATCH' END INTO source FROM deliveries WHERE tenant_id=t AND id=p_id;
   ELSE source:='DIRECT_ITEM';
 END CASE;
 IF source='BATCH' AND p_action<>'receive' THEN RETURN batch_workflow(p_action,p_id,p,p_key,p_hash);END IF;
 RETURN direct_command(p_action,p_id,p,p_key,p_hash);
END $$;
GRANT EXECUTE ON FUNCTION lumbung.workflow_command(text,uuid,jsonb,text,text) TO lumbung_app;
