SET LOCAL search_path=lumbung,pg_temp;

CREATE FUNCTION lumbung.create_release_plan(p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); prod products; rp release_plans; replay jsonb; result jsonb;
BEGIN
 PERFORM require_cap('allocation.run');PERFORM direct_policy('SAFETY');
 replay:=idem_begin(p_key,'create-release',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 SELECT * INTO prod FROM products WHERE tenant_id=t AND id=(p->>'product_id')::uuid;
 IF prod.id IS NULL OR NOT EXISTS(SELECT 1 FROM source_locations WHERE tenant_id=t AND id=(p->>'warehouse_id')::uuid AND kind='WAREHOUSE') THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 IF p_key IS NULL OR p->>'quantity' IS NULL OR (p->>'quantity')::numeric<=0 OR mod((p->>'quantity')::numeric,prod.min_increment)<>0 THEN PERFORM lb_raise('QTY_INCREMENT_VIOLATION');END IF;
 IF (p->>'pickup_start')::timestamptz<tenant_now() OR (p->>'receipt_at')::timestamptz<(p->>'pickup_start')::timestamptz OR (p->>'distribution_at')::timestamptz<(p->>'receipt_at')::timestamptz THEN PERFORM lb_raise('FOOD_WINDOW_EXCEEDED');END IF;
 INSERT INTO release_plans(tenant_id,warehouse_id,product_id,quantity,pickup_start,pickup_end,receipt_at,distribution_at,created_by)
   VALUES(t,(p->>'warehouse_id')::uuid,prod.id,(p->>'quantity')::numeric,(p->>'pickup_start')::timestamptz,(p->>'pickup_end')::timestamptz,(p->>'receipt_at')::timestamptz,(p->>'distribution_at')::timestamptz,current_user_id()) RETURNING * INTO rp;
 result:=jsonb_build_object('id',rp.id,'revision',1,'state','DRAFT');PERFORM append_audit('RELEASE_PLAN_CREATED','RELEASE_PLAN',rp.id,1,NULL,p);PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.create_release_plan(jsonb,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.save_inventory_run(p_release uuid,p_snapshot jsonb,p_result jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); rp release_plans; pol policy_versions; replay jsonb; rid uuid; result jsonb;
BEGIN
 PERFORM require_cap('allocation.run');pol:=direct_policy('ALLOCATION');
 replay:=idem_begin(p_key,'inventory-run',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 SELECT * INTO rp FROM release_plans WHERE tenant_id=t AND id=p_release FOR UPDATE;IF rp.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 IF rp.revision IS DISTINCT FROM (p_snapshot->>'item_revision')::int OR pol.id IS DISTINCT FROM (p_snapshot->>'policy_id')::uuid THEN PERFORM lb_raise('APPROVAL_STALE');END IF;
 INSERT INTO allocation_runs(tenant_id,release_plan_id,item_revision,policy_version_id,planning_date,horizon_start,horizon_end,now_at,feature_snapshot,result,facts_hash,created_by)
   VALUES(t,rp.id,rp.revision,pol.id,(p_snapshot->>'planning_date')::date,(p_snapshot->>'horizon_start')::timestamptz,(p_snapshot->>'horizon_end')::timestamptz,(p_snapshot->>'now')::timestamptz,p_snapshot,p_result,canonical_hash(p_snapshot),current_user_id()) RETURNING id INTO rid;
 result:=jsonb_build_object('id',rid,'release_plan_id',rp.id,'result',p_result);PERFORM append_audit('INVENTORY_RECOMMENDATION','ALLOCATION_RUN',rid,1,NULL,result,NULL,NULL,pol.id);PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.save_inventory_run(uuid,jsonb,jsonb,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.batch_dispatch_hash(p_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=lumbung,pg_temp AS $$
 SELECT canonical_hash(jsonb_build_object('allocation',to_jsonb(a)-ARRAY['state','updated_at'],'transport',to_jsonb(tr),'release',to_jsonb(rp),
   'safety_policy',(SELECT policy_version_id FROM tenant_active_policies WHERE tenant_id=a.tenant_id AND kind='SAFETY'),
   'batches',(SELECT jsonb_agg(jsonb_build_object('id',b.id,'qty',rl.quantity,'expiry',b.expires_at,'handling_deadline',b.handling_deadline,'restriction',b.restriction) ORDER BY b.id)
     FROM reservations r JOIN reservation_lines rl ON rl.tenant_id=r.tenant_id AND rl.reservation_id=r.id AND rl.state='ACTIVE'
     JOIN inventory_batches b ON b.tenant_id=rl.tenant_id AND b.id=rl.batch_id WHERE r.tenant_id=a.tenant_id AND r.allocation_id=a.id AND r.state='ACTIVE')))
 FROM allocations a JOIN release_plans rp ON rp.tenant_id=a.tenant_id AND rp.id=a.release_plan_id LEFT JOIN transport_arrangements tr ON tr.tenant_id=a.tenant_id AND tr.allocation_id=a.id WHERE a.tenant_id=current_tenant() AND a.id=p_id
$$;

ALTER FUNCTION lumbung.direct_release(uuid,text,text) RENAME TO release_direct_commitment;
CREATE FUNCTION lumbung.direct_release(p_allocation uuid,p_reason text,p_state text DEFAULT 'CANCELLED') RETURNS void
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE line record;
BEGIN
 IF EXISTS(SELECT 1 FROM allocations WHERE tenant_id=current_tenant() AND id=p_allocation AND source_type='BATCH' AND state NOT IN('DISPATCHED','RECEIVED','PARTIALLY_RECEIVED')) THEN
   PERFORM 1 FROM inventory_batches WHERE tenant_id=current_tenant() AND id IN(SELECT rl.batch_id FROM reservation_lines rl JOIN reservations r ON r.tenant_id=rl.tenant_id AND r.id=rl.reservation_id WHERE r.tenant_id=current_tenant() AND r.allocation_id=p_allocation AND r.state='ACTIVE' AND rl.state='ACTIVE') ORDER BY id FOR UPDATE;
   FOR line IN SELECT rl.*,b.restriction FROM reservation_lines rl JOIN reservations r ON r.tenant_id=rl.tenant_id AND r.id=rl.reservation_id JOIN inventory_batches b ON b.tenant_id=rl.tenant_id AND b.id=rl.batch_id
     WHERE r.tenant_id=current_tenant() AND r.allocation_id=p_allocation AND r.state='ACTIVE' AND rl.state='ACTIVE' ORDER BY b.id LOOP
     PERFORM post_stock_transfer(line.batch_id,'RESERVED',CASE WHEN line.restriction='NONE' THEN 'AVAILABLE' ELSE 'QUARANTINE' END,line.quantity,'RESERVATION_RELEASE',
       'release:'||line.id||':'||p_state,p_reason);
   END LOOP;
 END IF;
 PERFORM release_direct_commitment(p_allocation,p_reason,p_state);
END $$;

CREATE FUNCTION lumbung.batch_respond(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE o offers; a allocations; rp release_plans; prod products; r reservations; rl record; qty numeric; left_qty numeric; amount numeric; codes text[];
BEGIN
 SELECT * INTO o FROM offers WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;IF o.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 SELECT * INTO a FROM allocations WHERE tenant_id=current_tenant() AND id=o.allocation_id FOR UPDATE;
 IF o.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
 IF o.expires_at<=tenant_now() THEN PERFORM lb_raise('OFFER_EXPIRED');END IF;
 IF o.state NOT IN('SENT','DELIVERED') THEN PERFORM lb_raise('INVALID_STATE');END IF;
 IF p->>'response'='DECLINE' THEN
   PERFORM direct_release(a.id,coalesce(p->>'reason','OTHER'));
   UPDATE offers SET state='DECLINED',response_kind='DECLINE',decline_reason_code=p->>'reason',responded_at=tenant_now(),r_eligible=delivery_receipt_at IS NOT NULL,
     r_timely=delivery_receipt_at IS NOT NULL AND tenant_now()<=response_deadline,r_exclusion=CASE WHEN delivery_receipt_at IS NULL THEN 'NO_DELIVERY_RECEIPT' ELSE NULL END,revision=revision+1 WHERE tenant_id=current_tenant() AND id=o.id;
   RETURN jsonb_build_object('id',o.id,'state','DECLINED');
 END IF;
 SELECT * INTO rp FROM release_plans WHERE tenant_id=current_tenant() AND id=a.release_plan_id;SELECT * INTO prod FROM products WHERE tenant_id=current_tenant() AND id=rp.product_id;
 codes:=batch_eligibility(rp.id,a.flo_id,a.planned_receipt_at,a.planned_distribution_at);IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1]);END IF;
 qty:=(p->>'quantity')::numeric;
 IF p->>'response' NOT IN('ACCEPT','PARTIAL_ACCEPT') OR qty IS NULL OR qty<=0 OR qty>o.quantity OR mod(qty,prod.min_increment)<>0 OR (p->>'response'='ACCEPT' AND qty<>o.quantity) THEN PERFORM lb_raise('QTY_INCREMENT_VIOLATION');END IF;
 SELECT * INTO r FROM reservations WHERE tenant_id=current_tenant() AND allocation_id=a.id AND state='ACTIVE' ORDER BY id LIMIT 1 FOR UPDATE;
 IF r.id IS NULL OR r.expires_at<=tenant_now() THEN PERFORM lb_raise('OFFER_EXPIRED');END IF;
 left_qty:=a.quantity-qty;
 PERFORM 1 FROM inventory_batches WHERE tenant_id=current_tenant() AND id IN(SELECT batch_id FROM reservation_lines WHERE tenant_id=current_tenant() AND reservation_id=r.id AND state='ACTIVE') ORDER BY id FOR UPDATE;
 FOR rl IN SELECT l.* FROM reservation_lines l JOIN inventory_batches b ON b.tenant_id=l.tenant_id AND b.id=l.batch_id WHERE l.tenant_id=current_tenant() AND l.reservation_id=r.id AND l.state='ACTIVE' ORDER BY least(b.expires_at,b.handling_deadline) DESC,b.received_at DESC,b.id DESC LOOP
   IF left_qty<=0 THEN EXIT;END IF;amount:=least(left_qty,rl.quantity);
   PERFORM post_stock_transfer(rl.batch_id,'RESERVED','AVAILABLE',amount,'RESERVATION_RELEASE','partial:'||o.id||':'||rl.id,'PARTIAL_ACCEPT');
   UPDATE reservation_lines SET state=CASE WHEN amount=quantity THEN 'RELEASED' ELSE 'ACTIVE' END,quantity=CASE WHEN amount=quantity THEN quantity ELSE quantity-amount END WHERE tenant_id=current_tenant() AND id=rl.id;
   left_qty:=left_qty-amount;
 END LOOP;
 UPDATE reservations SET kind='RESERVATION',expires_at=least(tenant_now()+interval '2 hours',rp.pickup_end,a.planned_receipt_at-make_interval(mins=>(source_travel(rp.warehouse_id,a.flo_id)->>'minutes')::int)),revision=revision+1 WHERE tenant_id=current_tenant() AND id=r.id RETURNING * INTO r;
 UPDATE allocations SET quantity=qty,state='ACCEPTED_RESERVED',revision=revision+1 WHERE tenant_id=current_tenant() AND id=a.id;
 UPDATE offers SET state=CASE WHEN qty<quantity THEN 'PARTIALLY_ACCEPTED' ELSE 'ACCEPTED' END,accepted_qty=qty,response_kind=p->>'response',responded_at=tenant_now(),r_eligible=delivery_receipt_at IS NOT NULL,
   r_timely=delivery_receipt_at IS NOT NULL AND tenant_now()<=response_deadline,revision=revision+1 WHERE tenant_id=current_tenant() AND id=o.id;
 INSERT INTO jobs(tenant_id,kind,subject_type,subject_id,dedup_key,run_at) VALUES(current_tenant(),'BATCH_RESERVATION_EXPIRY','ALLOCATION',a.id,'batch-reservation:'||r.id,r.expires_at) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('id',o.id,'allocation_id',a.id,'state','ACCEPTED_RESERVED','quantity',qty::text);
END $$;

-- Internal adapters keep staff, inbound simulation and scoped FLO commands on
-- exactly the same source-specific acceptance and receipt rules.
ALTER FUNCTION lumbung.direct_respond(uuid,jsonb) RENAME TO respond_direct_offer;
CREATE FUNCTION lumbung.direct_respond(p_id uuid,p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM offers o JOIN allocations a ON a.tenant_id=o.tenant_id AND a.id=o.allocation_id WHERE o.tenant_id=current_tenant() AND o.id=p_id AND a.source_type='BATCH') THEN RETURN batch_respond(p_id,p);END IF;
 RETURN respond_direct_offer(p_id,p);
END $$;

CREATE FUNCTION lumbung.batch_workflow(p_action text,p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); cap text; replay jsonb; result jsonb; c outreach_campaigns; run allocation_runs; rp release_plans; prod products; line jsonb; cl campaign_lines;
 a allocations; o offers; r reservations; dl delivery_lines; d deliveries; batch record; rl record; bid uuid; rid uuid; offer_id uuid; outid uuid; contact uuid; qty numeric; remaining numeric; amount numeric; codes text[];
 expires timestamptz; idx int:=0; tz text; pickid uuid; hash text; pol policy_versions; due_rule text;
BEGIN
 cap:=CASE p_action WHEN 'draft' THEN 'allocation.run' WHEN 'approve-outreach' THEN 'outreach.approve' WHEN 'start' THEN 'campaign.start' WHEN 'respond' THEN 'offer.respond'
   WHEN 'transport' THEN 'transport.edit' WHEN 'approve-dispatch' THEN 'dispatch.approve' WHEN 'dispatch' THEN 'delivery.dispatch' WHEN 'release' THEN 'reservation.release' END;
 IF cap IS NULL THEN PERFORM lb_raise('BAD_REQUEST');END IF;PERFORM require_cap(cap);IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED');END IF;
 replay:=idem_begin(p_key,'batch:'||p_action,canonical_hash(jsonb_build_array(p_id,p,p_hash)));IF replay IS NOT NULL THEN RETURN replay;END IF;
 pol:=direct_policy('SAFETY');SELECT timezone INTO tz FROM tenants WHERE id=t;
 IF p_action='draft' THEN
   SELECT * INTO run FROM allocation_runs WHERE tenant_id=t AND id=p_id;
   SELECT * INTO rp FROM release_plans WHERE tenant_id=t AND id=run.release_plan_id FOR UPDATE;
   IF rp.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   IF rp.revision<>run.item_revision THEN PERFORM lb_raise('APPROVAL_STALE');END IF;
   IF jsonb_array_length(coalesce(p->'lines',run.result->'selected')) NOT BETWEEN 1 AND 3 THEN PERFORM lb_raise('STOCK_UNAVAILABLE');END IF;
   IF p ? 'lines' AND length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   SELECT * INTO prod FROM products WHERE tenant_id=t AND id=rp.product_id;
   INSERT INTO outreach_campaigns(tenant_id,release_plan_id,source_type,allocation_run_id,state,response_window_min,template_version,plan_hash,created_by)
     VALUES(t,rp.id,'BATCH',run.id,'AWAITING_APPROVAL',240,'OFFER-ID-1',canonical_hash(jsonb_build_object('run',run.facts_hash,'lines',coalesce(p->'lines',run.result->'selected'))),current_user_id()) RETURNING * INTO c;
   FOR line IN SELECT * FROM jsonb_array_elements(coalesce(p->'lines',run.result->'selected')) LOOP
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements((run.result->'selected')||(run.result->'alternatives')) x WHERE x->>'flo_id'=line->>'flo_id') THEN PERFORM lb_raise('POLICY_VIOLATION');END IF;
     codes:=batch_eligibility(rp.id,(line->>'flo_id')::uuid,rp.receipt_at,rp.distribution_at);IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1]);END IF;
     qty:=(line->>'quantity')::numeric;IF qty<=0 OR mod(qty,prod.min_increment)<>0 THEN PERFORM lb_raise('QTY_INCREMENT_VIOLATION');END IF;
     idx:=idx+1;INSERT INTO campaign_lines(tenant_id,campaign_id,campaign_revision,flo_id,wave_no,rank,max_qty,unit,receiving_start,receiving_end,distribution_deadline,planned_receipt_at)
       VALUES(t,c.id,1,(line->>'flo_id')::uuid,1,idx,qty,prod.base_unit,rp.receipt_at,rp.receipt_at+interval '30 minutes',rp.distribution_at,rp.receipt_at);
   END LOOP;
   result:=jsonb_build_object('id',c.id,'revision',1,'state',c.state);
 ELSIF p_action IN('approve-outreach','start') THEN
   SELECT * INTO c FROM outreach_campaigns WHERE tenant_id=t AND id=p_id FOR UPDATE;IF c.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   SELECT * INTO rp FROM release_plans WHERE tenant_id=t AND id=c.release_plan_id;SELECT * INTO prod FROM products WHERE tenant_id=t AND id=rp.product_id;
   IF c.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
   IF p_action='approve-outreach' THEN
     IF c.state<>'AWAITING_APPROVAL' THEN PERFORM lb_raise('INVALID_STATE');END IF;
     INSERT INTO approvals(tenant_id,stage,subject_type,subject_id,subject_revision,input_hash,approver_id,approved_at,expires_at,reason)
       VALUES(t,'OUTREACH','CAMPAIGN',c.id,c.revision,c.plan_hash,current_user_id(),tenant_now(),rp.pickup_end,p->>'reason');
     UPDATE outreach_campaigns SET state='APPROVED' WHERE tenant_id=t AND id=c.id;result:=jsonb_build_object('id',c.id,'revision',c.revision,'state','APPROVED');
   ELSE
     IF c.state<>'APPROVED' OR NOT EXISTS(SELECT 1 FROM approvals WHERE tenant_id=t AND subject_id=c.id AND stage='OUTREACH' AND subject_revision=c.revision AND input_hash=c.plan_hash AND invalidated_at IS NULL AND expires_at>tenant_now()) THEN PERFORM lb_raise('OUTREACH_APPROVAL_REQUIRED');END IF;
     PERFORM 1 FROM inventory_batches b JOIN storage_locations sl ON sl.tenant_id=b.tenant_id AND sl.id=b.storage_location_id WHERE b.tenant_id=t AND b.product_id=prod.id AND sl.warehouse_id=rp.warehouse_id ORDER BY b.id FOR UPDATE OF b;
     PERFORM 1 FROM flo_category_capacities WHERE tenant_id=t AND category_id=prod.category_id AND flo_id IN(SELECT flo_id FROM campaign_lines WHERE tenant_id=t AND campaign_id=c.id) ORDER BY id FOR UPDATE;
     SELECT coalesce(sum(quantity),0) INTO amount FROM allocations WHERE tenant_id=t AND release_plan_id=rp.id AND state NOT IN('PROPOSED','CANCELLED','EXPIRED','EXCEPTION');
     FOR cl IN SELECT * FROM campaign_lines WHERE tenant_id=t AND campaign_id=c.id AND campaign_revision=c.revision ORDER BY rank LOOP
       codes:=batch_eligibility(rp.id,cl.flo_id,cl.planned_receipt_at,cl.distribution_deadline);IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1]);END IF;
       PERFORM lock_direct_recipient(cl.flo_id,prod.category_id);
       IF cl.max_qty>flo_remaining_capacity(prod.id,cl.flo_id,(cl.distribution_deadline AT TIME ZONE tz)::date) THEN PERFORM lb_raise('CAPACITY_EXCEEDED');END IF;
       amount:=amount+cl.max_qty;IF amount>rp.quantity THEN PERFORM lb_raise('STOCK_UNAVAILABLE');END IF;
       expires:=least(tenant_now()+interval '4 hours',rp.pickup_end,rp.receipt_at-make_interval(mins=>(source_travel(rp.warehouse_id,cl.flo_id)->>'minutes')::int));
       IF expires<=tenant_now() OR NOT direct_window_open(cl.flo_id,'CONTACT',tenant_now()) THEN PERFORM lb_raise('CONTACT_CLOSED');END IF;
       SELECT id INTO contact FROM flo_contacts WHERE tenant_id=t AND flo_id=cl.flo_id AND channel='SIM' AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL ORDER BY id LIMIT 1;
       INSERT INTO allocations(tenant_id,code,release_plan_id,source_type,flo_id,category_id,quantity,unit,unit_kind,state,chosen_run_id,campaign_id,planned_pickup_start,planned_pickup_end,planned_receipt_at,planned_distribution_at,planned_service_date)
         VALUES(t,'AL-'||upper(substr(gen_random_uuid()::text,1,8)),rp.id,'BATCH',cl.flo_id,prod.category_id,cl.max_qty,prod.base_unit,prod.unit_kind,'OFFER_HELD',c.allocation_run_id,c.id,rp.pickup_start,rp.pickup_end,rp.receipt_at,rp.distribution_at,(rp.distribution_at AT TIME ZONE tz)::date) RETURNING * INTO a;
       INSERT INTO offers(tenant_id,code,campaign_id,campaign_line_id,campaign_revision,allocation_id,flo_id,contact_id,quantity,unit,state,expires_at,queued_at)
         VALUES(t,'OF-'||upper(substr(gen_random_uuid()::text,1,8)),c.id,cl.id,c.revision,a.id,cl.flo_id,contact,a.quantity,a.unit,'QUEUED',expires,tenant_now()) RETURNING id INTO offer_id;
       INSERT INTO reservations(tenant_id,kind,source_type,allocation_id,offer_id,expires_at) VALUES(t,'HOLD','BATCH',a.id,offer_id,expires) RETURNING id INTO rid;
       remaining:=a.quantity;
       FOR batch IN SELECT b.*,bb.qty FROM inventory_batches b JOIN storage_locations sl ON sl.tenant_id=b.tenant_id AND sl.id=b.storage_location_id JOIN batch_balances bb ON bb.tenant_id=b.tenant_id AND bb.batch_id=b.id AND bb.account='AVAILABLE' AND bb.qty>0
         WHERE b.tenant_id=t AND b.product_id=prod.id AND sl.warehouse_id=rp.warehouse_id AND batch_is_usable(b.id,rp.distribution_at) ORDER BY least(b.expires_at,b.handling_deadline),b.received_at,b.id LOOP
         EXIT WHEN remaining=0;qty:=least(batch.qty,remaining);
         PERFORM post_stock_transfer(batch.id,'AVAILABLE','RESERVED',qty,'RESERVATION_TRANSFER',p_key||':'||a.id||':'||batch.id,'APPROVED_OFFER');
         INSERT INTO reservation_lines(tenant_id,reservation_id,batch_id,quantity,unit) VALUES(t,rid,batch.id,qty,a.unit);remaining:=remaining-qty;
       END LOOP;
       IF remaining>0 THEN PERFORM lb_raise('STOCK_UNAVAILABLE');END IF;
       INSERT INTO outbox(tenant_id,kind,dedupe_key,payload,purpose,locale,template,expires_at) VALUES(t,'MESSAGE','offer:'||offer_id,jsonb_build_object('offer_id',offer_id,'contact_id',contact,'text','Bu/Pak, ada '||a.quantity||' '||a.unit||' '||prod.name||' dari gudang, referensi '||(SELECT code FROM offers WHERE tenant_id=t AND id=offer_id)||'. Ongkir ditanggung FLO; menunggu konfirmasi dan persetujuan akhir FoodCycle.'),'APPROVED_OFFER','id','OFFER-ID-1',expires) RETURNING id INTO outid;
       UPDATE offers SET outbox_id=outid WHERE tenant_id=t AND id=offer_id;
       INSERT INTO jobs(tenant_id,kind,subject_type,subject_id,dedup_key,run_at) VALUES(t,'BATCH_OFFER_EXPIRY','ALLOCATION',a.id,'batch-offer-expiry:'||offer_id,expires);
     END LOOP;
     UPDATE outreach_campaigns SET state='RUNNING' WHERE tenant_id=t AND id=c.id;result:=jsonb_build_object('id',c.id,'revision',c.revision,'state','RUNNING');
   END IF;
 ELSIF p_action='respond' THEN result:=batch_respond(p_id,p);
 ELSIF p_action='transport' THEN result:=direct_transport(p_id,p);
 ELSIF p_action='release' THEN
   SELECT * INTO a FROM allocations WHERE tenant_id=t AND id=p_id FOR UPDATE;IF a.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   IF a.revision IS DISTINCT FROM (p->>'expected_revision')::int OR a.state IN('DISPATCHED','RECEIVED','PARTIALLY_RECEIVED') THEN PERFORM lb_raise('INVALID_STATE');END IF;
   PERFORM direct_release(a.id,p->>'reason');result:=jsonb_build_object('id',a.id,'state','CANCELLED');
 ELSIF p_action='approve-dispatch' THEN
   SELECT * INTO a FROM allocations WHERE tenant_id=t AND id=p_id FOR UPDATE;IF a.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   IF a.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
   IF a.state<>'AWAITING_FINAL_APPROVAL' THEN PERFORM lb_raise('INVALID_STATE');END IF;
   SELECT * INTO rp FROM release_plans WHERE tenant_id=t AND id=a.release_plan_id;SELECT * INTO prod FROM products WHERE tenant_id=t AND id=rp.product_id;
   PERFORM lock_direct_recipient(a.flo_id,a.category_id);codes:=batch_eligibility(rp.id,a.flo_id,a.planned_receipt_at,a.planned_distribution_at);IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1]);END IF;
   IF NOT EXISTS(SELECT 1 FROM transport_arrangements WHERE tenant_id=t AND allocation_id=a.id AND quote_status IN('CONFIRMED','NOT_APPLICABLE') AND fee_accepted_at IS NOT NULL AND fee_refused_at IS NULL AND payer='FLO') THEN PERFORM lb_raise('TRANSPORT_UNCONFIRMED');END IF;
   SELECT * INTO r FROM reservations WHERE tenant_id=t AND allocation_id=a.id AND state='ACTIVE' AND kind='RESERVATION' AND expires_at>tenant_now() ORDER BY id LIMIT 1 FOR UPDATE;
   IF r.id IS NULL THEN PERFORM lb_raise('OFFER_EXPIRED');END IF;
   IF EXISTS(SELECT 1 FROM reservation_lines WHERE tenant_id=t AND reservation_id=r.id AND state='ACTIVE' AND NOT batch_is_usable(batch_id,a.planned_distribution_at)) THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED');END IF;
   INSERT INTO approvals(tenant_id,stage,subject_type,subject_id,subject_revision,input_hash,approver_id,approved_at,expires_at,reason)
     VALUES(t,'FINAL_DISPATCH','ALLOCATION',a.id,a.revision,batch_dispatch_hash(a.id),current_user_id(),tenant_now(),r.expires_at,p->>'reason');
   SELECT d0.* INTO d FROM deliveries d0 JOIN delivery_lines dl0 ON dl0.tenant_id=d0.tenant_id AND dl0.delivery_id=d0.id WHERE dl0.tenant_id=t AND dl0.allocation_id=a.id LIMIT 1;
   IF d.id IS NULL THEN
     INSERT INTO deliveries(tenant_id,code,route,source_location_id,destination_flo_id,state,planned_pickup_at,planned_arrival_at) VALUES(t,'DO-'||upper(substr(gen_random_uuid()::text,1,8)),'WAREHOUSE_OUTBOUND',rp.warehouse_id,a.flo_id,'READY_FOR_PICKUP',a.planned_pickup_start,a.planned_receipt_at) RETURNING * INTO d;
     INSERT INTO pick_lists(tenant_id,delivery_id) VALUES(t,d.id) RETURNING id INTO pickid;
     FOR rl IN SELECT * FROM reservation_lines WHERE tenant_id=t AND reservation_id=r.id AND state='ACTIVE' ORDER BY batch_id LOOP
       INSERT INTO delivery_lines(tenant_id,delivery_id,allocation_id,batch_id,product_id,category_id,unit,unit_kind,offered_qty,allocated_qty) VALUES(t,d.id,a.id,rl.batch_id,prod.id,prod.category_id,a.unit,a.unit_kind,rl.quantity,rl.quantity);
       INSERT INTO pick_lines(tenant_id,pick_list_id,reservation_line_id,batch_id,planned_qty) VALUES(t,pickid,rl.id,rl.batch_id,rl.quantity);
     END LOOP;
   END IF;
   UPDATE allocations SET state='APPROVED' WHERE tenant_id=t AND id=a.id;result:=jsonb_build_object('id',a.id,'revision',a.revision,'state','APPROVED','delivery_id',d.id);
 ELSIF p_action='dispatch' THEN
   SELECT * INTO d FROM deliveries WHERE tenant_id=t AND id=p_id FOR UPDATE;IF d.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   IF d.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
   IF d.state<>'READY_FOR_PICKUP' THEN PERFORM lb_raise('INVALID_STATE');END IF;
   IF NOT EXISTS(SELECT 1 FROM pick_lists WHERE tenant_id=t AND delivery_id=d.id AND state='PICKED') THEN PERFORM lb_raise('PICK_REQUIRED');END IF;
   FOR a IN SELECT a0.* FROM allocations a0 WHERE a0.tenant_id=t AND a0.id IN(SELECT allocation_id FROM delivery_lines WHERE tenant_id=t AND delivery_id=d.id) ORDER BY a0.id FOR UPDATE LOOP
     SELECT * INTO rp FROM release_plans WHERE tenant_id=t AND id=a.release_plan_id;
     IF a.state<>'APPROVED' OR NOT EXISTS(SELECT 1 FROM approvals WHERE tenant_id=t AND subject_id=a.id AND stage='FINAL_DISPATCH' AND subject_revision=a.revision AND input_hash=batch_dispatch_hash(a.id) AND invalidated_at IS NULL AND expires_at>tenant_now()) THEN PERFORM lb_raise('DISPATCH_APPROVAL_REQUIRED');END IF;
     codes:=batch_eligibility(rp.id,a.flo_id,a.planned_receipt_at,a.planned_distribution_at);IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1]);END IF;
     IF tenant_now()<a.planned_pickup_start OR tenant_now()>=a.planned_pickup_end THEN PERFORM lb_raise('FOOD_WINDOW_EXCEEDED');END IF;
     SELECT * INTO r FROM reservations WHERE tenant_id=t AND allocation_id=a.id AND kind='RESERVATION' AND state='ACTIVE' AND expires_at>tenant_now() ORDER BY id LIMIT 1 FOR UPDATE;IF r.id IS NULL THEN PERFORM lb_raise('OFFER_EXPIRED');END IF;
     FOR dl IN SELECT * FROM delivery_lines WHERE tenant_id=t AND delivery_id=d.id AND allocation_id=a.id AND NOT cancelled ORDER BY batch_id LOOP
       IF NOT batch_is_usable(dl.batch_id,a.planned_distribution_at) OR dl.picked_qty IS DISTINCT FROM dl.allocated_qty THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED');END IF;
       PERFORM post_stock_transfer(dl.batch_id,'RESERVED','IN_TRANSIT',dl.allocated_qty,'DISPATCH_TRANSFER',p_key||':'||dl.id,'PICKUP');
       UPDATE delivery_lines SET dispatched_qty=allocated_qty WHERE tenant_id=t AND id=dl.id;
     END LOOP;
     UPDATE reservation_lines SET state='CONSUMED' WHERE tenant_id=t AND reservation_id=r.id AND state='ACTIVE';UPDATE reservations SET state='CONSUMED' WHERE tenant_id=t AND id=r.id;
     UPDATE allocations SET state='DISPATCHED' WHERE tenant_id=t AND id=a.id;
   END LOOP;
   UPDATE deliveries SET state='IN_TRANSIT',custodian=p->>'custodian',dispatched_at=tenant_now(),picked_up_at=tenant_now(),revision=revision+1 WHERE tenant_id=t AND id=d.id RETURNING * INTO d;
   pol:=direct_policy('REPORTING');due_rule:=pol.body->'due_rules'->>'RECEIPT_PHOTO';
   INSERT INTO evidence_obligations(tenant_id,type,subject_type,subject_id,anchor_kind,anchor_at,due_at,due_rule,timezone,policy_version_id) VALUES(t,'RECEIPT_PHOTO','DELIVERY',d.id,'DISPATCH',tenant_now(),compute_due_at(due_rule,tenant_now(),tz),due_rule,tz,pol.id);
   result:=jsonb_build_object('id',d.id,'revision',d.revision,'state',d.state);
 END IF;
 PERFORM append_audit('BATCH_'||upper(p_action),'WAREHOUSE_WORKFLOW',p_id,(result->>'revision')::int,p->>'reason',jsonb_build_object('request',p,'result',result),NULL,result,pol.id);
 PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.batch_workflow(text,uuid,jsonb,text,text) TO lumbung_app;
