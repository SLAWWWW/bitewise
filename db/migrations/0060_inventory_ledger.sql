SET LOCAL search_path=lumbung,pg_temp;

ALTER TABLE release_plans ADD COLUMN product_id uuid,ADD COLUMN quantity numeric(14,3),ADD COLUMN pickup_start timestamptz,ADD COLUMN pickup_end timestamptz,
  ADD COLUMN receipt_at timestamptz,ADD COLUMN distribution_at timestamptz,
  ADD FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),ADD CHECK(quantity>0),ADD CHECK(pickup_end>pickup_start);
ALTER TABLE allocation_runs ADD COLUMN release_plan_id uuid,ADD FOREIGN KEY(tenant_id,release_plan_id) REFERENCES release_plans(tenant_id,id);
ALTER TABLE stock_movements ADD COLUMN request_hash text;
CREATE UNIQUE INDEX stock_command_dedupe ON stock_movements(tenant_id,command_id) WHERE request_hash IS NOT NULL;
ALTER TABLE inbound_lines ADD COLUMN received_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK(received_qty>=0);
ALTER TABLE stock_adjustment_requests ADD COLUMN reversal_of uuid,ADD FOREIGN KEY(tenant_id,reversal_of) REFERENCES stock_movements(tenant_id,id);

-- All ledger writes pass through this owner-only transfer. Balances and immutable
-- balanced entries change atomically under the batch lock, including replays.
CREATE FUNCTION lumbung.post_stock_transfer(p_batch uuid,p_from text,p_to text,p_qty numeric,p_type text,p_command text,p_reason text,p_reversal uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); b inventory_batches; mid uuid; old_hash text; h text; source_qty numeric;
BEGIN
  SELECT * INTO b FROM inventory_batches WHERE tenant_id=t AND id=p_batch FOR UPDATE;
  IF b.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF p_from=p_to OR p_qty IS NULL OR p_qty<=0 OR p_qty<>round(p_qty,3) OR (b.unit_kind='COUNT' AND p_qty<>trunc(p_qty)) THEN PERFORM lb_raise('QTY_INCREMENT_VIOLATION'); END IF;
  h:=canonical_hash(jsonb_build_array(p_batch,p_from,p_to,p_qty,p_type,p_reason,p_reversal));
  SELECT id,request_hash INTO mid,old_hash FROM stock_movements WHERE tenant_id=t AND command_id=p_command AND request_hash IS NOT NULL;
  IF mid IS NOT NULL THEN IF old_hash<>h THEN PERFORM lb_raise('IDEMPOTENCY_PAYLOAD_MISMATCH');END IF;RETURN mid;END IF;
  INSERT INTO batch_balances(tenant_id,batch_id,account,qty) VALUES(t,b.id,p_from,0),(t,b.id,p_to,0) ON CONFLICT DO NOTHING;
  SELECT qty INTO source_qty FROM batch_balances WHERE tenant_id=t AND batch_id=b.id AND account=p_from;
  IF p_from NOT IN('EXTERNAL_RECEIPT','ADJUSTMENT_OFFSET') AND source_qty<p_qty THEN PERFORM lb_raise('STOCK_UNAVAILABLE'); END IF;
  INSERT INTO stock_movements(tenant_id,command_id,type,reversal_of,reason,actor_id,occurred_at,correlation_id,request_hash,created_by)
    VALUES(t,p_command,p_type,p_reversal,p_reason,current_user_id(),tenant_now(),current_correlation_id(),h,current_user_id()) RETURNING id INTO mid;
  INSERT INTO movement_entries(tenant_id,movement_id,batch_id,account,signed_qty,created_by)
    VALUES(t,mid,b.id,p_from,-p_qty,current_user_id()),(t,mid,b.id,p_to,p_qty,current_user_id());
  UPDATE batch_balances SET qty=qty+CASE WHEN account=p_from THEN -p_qty ELSE p_qty END,updated_at=tenant_now()
    WHERE tenant_id=t AND batch_id=b.id AND account IN(p_from,p_to);
  PERFORM emit_event('STOCK_'||p_type,'BATCH',b.id,NULL,jsonb_build_object('movement_id',mid,'from',p_from,'to',p_to,'quantity',p_qty::text));RETURN mid;
END $$;

CREATE FUNCTION lumbung.batch_is_usable(p_id uuid,p_until timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=lumbung,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM inventory_batches b WHERE b.tenant_id=current_tenant() AND b.id=p_id AND b.restriction='NONE'
   AND least(b.expires_at,b.handling_deadline)>greatest(tenant_now(),p_until)
   AND NOT EXISTS(SELECT 1 FROM recalls r WHERE r.tenant_id=b.tenant_id AND r.state='OPEN' AND (r.batch_id=b.id OR r.product_id=b.product_id)))
$$;

CREATE FUNCTION lumbung.inventory_command(p_action text,p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); cap text; replay jsonb; result jsonb; prod products; o donation_orders; ib expected_inbounds; il inbound_lines;
  b inventory_batches; adj stock_adjustment_requests; line jsonb; v_id uuid; v_inspection_id uuid; actual numeric; accepted numeric; held numeric; rejected numeric;
  expiry timestamptz; until_at timestamptz; pol policy_versions; cat text; n int:=0; item_id uuid; v_qty numeric; movement stock_movements; entry movement_entries; other_entry movement_entries;
BEGIN
  cap:=CASE p_action WHEN 'inbound' THEN 'inventory.receive' WHEN 'receive' THEN 'inventory.inspect' WHEN 'release-hold' THEN 'inventory.quarantine_release'
    WHEN 'adjust' THEN 'inventory.adjust.request' WHEN 'approve-adjust' THEN 'inventory.adjust.approve' WHEN 'recall' THEN 'inventory.recall' WHEN 'return' THEN 'inventory.receive' END;
  IF cap IS NULL THEN PERFORM lb_raise('BAD_REQUEST'); END IF;PERFORM require_cap(cap);
  IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
  IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED');END IF;
  replay:=idem_begin(p_key,'inventory:'||p_action,canonical_hash(jsonb_build_array(p_id,p,p_hash)));IF replay IS NOT NULL THEN RETURN replay;END IF;
  pol:=direct_policy('SAFETY');
  CASE p_action
    WHEN 'inbound' THEN
      IF NOT EXISTS(SELECT 1 FROM source_locations WHERE tenant_id=t AND id=(p->>'warehouse_id')::uuid AND kind='WAREHOUSE')
        OR NOT EXISTS(SELECT 1 FROM source_locations WHERE tenant_id=t AND id=(p->>'source_location_id')::uuid AND donor_id=(p->>'donor_id')::uuid AND kind='DONOR_SITE') THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
      IF jsonb_array_length(p->'items') NOT BETWEEN 1 AND 20 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
      INSERT INTO donation_orders(tenant_id,code,donor_id,source_location_id,route,intake_channel,donation_reason,pickup_start,pickup_end,operational_state,created_by)
        VALUES(t,'IN-'||upper(substr(gen_random_uuid()::text,1,8)),(p->>'donor_id')::uuid,(p->>'source_location_id')::uuid,'WAREHOUSE_INBOUND','MANUAL',p->>'donation_reason',tenant_now(),greatest(tenant_now()+interval '1 hour',(p->>'expected_at')::timestamptz+interval '1 hour'),'DRAFT',current_user_id()) RETURNING * INTO o;
      INSERT INTO expected_inbounds(tenant_id,order_id,warehouse_id,expected_at,created_by) VALUES(t,o.id,(p->>'warehouse_id')::uuid,(p->>'expected_at')::timestamptz,current_user_id()) RETURNING * INTO ib;
      FOR line IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
        SELECT * INTO prod FROM products WHERE tenant_id=t AND id=(line->>'product_id')::uuid;IF prod.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
        IF line->>'unit' IS DISTINCT FROM prod.base_unit OR mod((line->>'quantity')::numeric,prod.min_increment)<>0 THEN PERFORM lb_raise('UNIT_MISMATCH');END IF;
        n:=n+1;INSERT INTO donation_items(tenant_id,order_id,line_no,product_id,category_id,description,quantity,unit,unit_kind,storage_req,created_by)
          VALUES(t,o.id,n,prod.id,prod.category_id,prod.name,(line->>'quantity')::numeric,prod.base_unit,prod.unit_kind,prod.storage_profile,current_user_id()) RETURNING id INTO item_id;
        INSERT INTO inbound_lines(tenant_id,inbound_id,item_id,product_id,expected_qty,unit,created_by) VALUES(t,ib.id,item_id,prod.id,(line->>'quantity')::numeric,prod.base_unit,current_user_id());
      END LOOP;
      result:=jsonb_build_object('id',ib.id,'revision',1,'state','EXPECTED');
    WHEN 'receive' THEN
      SELECT * INTO ib FROM expected_inbounds WHERE tenant_id=t AND id=p_id FOR UPDATE;IF ib.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
      IF ib.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
      IF ib.state NOT IN('EXPECTED','ARRIVED') THEN PERFORM lb_raise('INVALID_STATE');END IF;
      IF jsonb_array_length(p->'lines') NOT BETWEEN 1 AND 20 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
      INSERT INTO inspections(tenant_id,inbound_id,inspector_id,inspected_at,observations,created_by) VALUES(t,ib.id,current_user_id(),tenant_now(),jsonb_build_object('reason',p->>'reason'),current_user_id()) RETURNING id INTO v_inspection_id;
      FOR line IN SELECT * FROM jsonb_array_elements(p->'lines') LOOP
        SELECT * INTO il FROM inbound_lines WHERE tenant_id=t AND inbound_id=ib.id AND id=(line->>'inbound_line_id')::uuid FOR UPDATE;
        IF il.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
        IF EXISTS(SELECT 1 FROM inspection_lines WHERE tenant_id=t AND inspection_id=v_inspection_id AND inbound_line_id=il.id) THEN PERFORM lb_raise('BAD_REQUEST');END IF;
        SELECT * INTO prod FROM products WHERE tenant_id=t AND id=il.product_id;SELECT code INTO cat FROM categories WHERE tenant_id=t AND id=prod.category_id;
        actual:=(line->>'actual_quantity')::numeric;accepted:=(line->>'accepted_quantity')::numeric;held:=(line->>'quarantined_quantity')::numeric;rejected:=(line->>'rejected_quantity')::numeric;
        IF actual IS NULL OR accepted IS NULL OR held IS NULL OR rejected IS NULL OR least(actual,accepted,held,rejected)<0 OR actual<>accepted+held+rejected OR actual<>round(actual,3)
          OR (prod.unit_kind='COUNT' AND (actual<>trunc(actual) OR accepted<>trunc(accepted) OR held<>trunc(held) OR rejected<>trunc(rejected))) THEN PERFORM lb_raise('INSPECTION_UNBALANCED');END IF;
        IF line->>'unit' IS DISTINCT FROM il.unit THEN PERFORM lb_raise('UNIT_MISMATCH');END IF;
        IF NOT EXISTS(SELECT 1 FROM storage_locations WHERE tenant_id=t AND id=(line->>'storage_location_id')::uuid AND warehouse_id=ib.warehouse_id AND storage_profile=prod.storage_profile) THEN PERFORM lb_raise('STORAGE_INCOMPATIBLE');END IF;
        expiry:=(line->>'expiry_at')::timestamptz;until_at:=expiry;
        IF pol.body->'profiles'->cat ? 'max_hours_from_ready' THEN until_at:=least(expiry,(line->>'ready_at')::timestamptz+make_interval(hours=>(pol.body->'profiles'->cat->>'max_hours_from_ready')::int));END IF;
        IF accepted>0 AND ((pol.body->'profiles'->cat ? 'max_hours_from_ready' AND line->>'ready_at' IS NULL) OR line->>'condition' IS DISTINCT FROM 'GOOD' OR until_at IS NULL OR until_at<=tenant_now()+make_interval(hours=>coalesce((pol.body->>'min_handling_hours')::int,2))
          OR (coalesce((pol.body->'profiles'->cat->>'requires_label_expiry')::boolean,false) AND (expiry IS NULL OR expiry<tenant_now()+make_interval(days=>(pol.body->>'warehouse_min_remaining_shelf_days')::int)))) THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED');END IF;
        IF length(trim(coalesce(line->>'inspection_reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
        INSERT INTO inspection_lines(tenant_id,inspection_id,inbound_line_id,external_lot,label_expiry,actual_qty,accepted_qty,quarantined_qty,rejected_qty,condition,storage_obs)
          VALUES(t,v_inspection_id,il.id,line->>'lot',expiry,actual,accepted,held,rejected,line->>'condition',line->>'inspection_reason');
        IF accepted>0 OR held>0 THEN
          FOR n IN 1..2 LOOP
            v_qty:=CASE n WHEN 1 THEN accepted ELSE held END;IF v_qty=0 THEN CONTINUE;END IF;
            INSERT INTO inventory_batches(tenant_id,batch_code,product_id,category_id,donor_order_id,donor_line_id,external_lot,base_unit,unit_kind,storage_location_id,received_at,expires_at,handling_deadline,condition,inspection_id,restriction,created_by)
              VALUES(t,'LOT-'||upper(substr(gen_random_uuid()::text,1,8)),prod.id,prod.category_id,ib.order_id,il.item_id,line->>'lot',prod.base_unit,prod.unit_kind,(line->>'storage_location_id')::uuid,tenant_now(),expiry,until_at,line->>'condition',v_inspection_id,CASE n WHEN 1 THEN 'NONE' ELSE 'QUARANTINED' END,current_user_id()) RETURNING id INTO v_id;
            PERFORM post_stock_transfer(v_id,'EXTERNAL_RECEIPT',CASE n WHEN 1 THEN 'AVAILABLE' ELSE 'QUARANTINE' END,v_qty,'RECEIPT',p_key||':'||il.id||':'||n,line->>'inspection_reason');
            INSERT INTO safety_evaluations(tenant_id,subject_type,subject_id,policy_version_id,inputs_hash,deterministic_verdict,verdict,reasons,usable_until,reviewer_id,reviewed_at)
              VALUES(t,'BATCH',v_id,pol.id,canonical_hash(line),CASE n WHEN 1 THEN 'CLEARED' ELSE 'REVIEW_REQUIRED' END,CASE n WHEN 1 THEN 'CLEARED' ELSE 'REVIEW_REQUIRED' END,'{}',until_at,current_user_id(),tenant_now());
          END LOOP;
        END IF;
        IF rejected>0 THEN INSERT INTO dispositions(tenant_id,source_type,source_id,qty,unit,kind,decided_by,reason) VALUES(t,'INBOUND_LINE',il.id,rejected,il.unit,'REJECTED',current_user_id(),line->>'inspection_reason');END IF;
        UPDATE inbound_lines SET received_qty=received_qty+actual WHERE tenant_id=t AND id=il.id;
        IF actual<>il.expected_qty-il.received_qty THEN INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
          VALUES(t,'INBOUND_DISCREPANCY','INBOUND',ib.id,'MEDIUM','inbound-discrepancy:'||p_key||':'||il.id,jsonb_build_object('expected_remaining',il.expected_qty-il.received_qty,'actual',actual)) ON CONFLICT DO NOTHING;END IF;
      END LOOP;
      UPDATE expected_inbounds SET state=CASE WHEN coalesce((p->>'complete')::boolean,true) THEN 'CLOSED' ELSE 'ARRIVED' END,revision=revision+1 WHERE tenant_id=t AND id=ib.id RETURNING * INTO ib;
      UPDATE donation_orders SET operational_state=CASE WHEN ib.state='CLOSED' THEN 'CLOSED' ELSE 'READY' END,revision=revision+1 WHERE tenant_id=t AND id=ib.order_id;
      result:=jsonb_build_object('id',ib.id,'revision',ib.revision,'state',ib.state,'inspection_id',v_inspection_id);
    WHEN 'adjust' THEN
      SELECT * INTO b FROM inventory_batches WHERE tenant_id=t AND id=(p->>'batch_id')::uuid FOR UPDATE;IF b.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
      IF NOT EXISTS(SELECT 1 FROM media_files WHERE tenant_id=t AND id=(p->>'media_id')::uuid AND subject_id=b.id AND deletion_state='ACTIVE') OR length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('EVIDENCE_REQUIRED');END IF;
      INSERT INTO stock_adjustment_requests(tenant_id,batch_id,requested_delta,count_evidence_media_id,requester_id,reason,reversal_of)
        VALUES(t,b.id,(p->>'delta')::numeric,(p->>'media_id')::uuid,current_user_id(),p->>'reason',(p->>'reversal_of')::uuid) RETURNING id INTO v_id;
      result:=jsonb_build_object('id',v_id,'revision',1,'state','REQUESTED');
    WHEN 'approve-adjust' THEN
      SELECT * INTO adj FROM stock_adjustment_requests WHERE tenant_id=t AND id=p_id FOR UPDATE;IF adj.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
      IF adj.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
      IF adj.state<>'REQUESTED' THEN PERFORM lb_raise('INVALID_STATE');END IF;
      IF adj.requester_id=current_user_id() THEN PERFORM lb_raise('SELF_APPROVAL_FORBIDDEN');END IF;
      IF adj.reversal_of IS NOT NULL THEN
        SELECT * INTO movement FROM stock_movements WHERE tenant_id=t AND id=adj.reversal_of AND type='RECEIPT';IF movement.id IS NULL THEN PERFORM lb_raise('INVALID_STATE');END IF;
        SELECT * INTO entry FROM movement_entries WHERE tenant_id=t AND movement_id=movement.id AND batch_id=adj.batch_id AND account='AVAILABLE' AND signed_qty>0;
        IF entry.id IS NULL OR entry.signed_qty+adj.requested_delta<=0 THEN PERFORM lb_raise('INVALID_STATE');END IF;
        PERFORM post_stock_transfer(adj.batch_id,'AVAILABLE','EXTERNAL_RECEIPT',entry.signed_qty,'REVERSAL',p_key||':reverse',p->>'reason',movement.id);
        PERFORM post_stock_transfer(adj.batch_id,'EXTERNAL_RECEIPT','AVAILABLE',entry.signed_qty+adj.requested_delta,'ADJUSTMENT',p_key||':corrected',p->>'reason');
      ELSE
        PERFORM post_stock_transfer(adj.batch_id,CASE WHEN adj.requested_delta>0 THEN 'ADJUSTMENT_OFFSET' ELSE 'AVAILABLE' END,CASE WHEN adj.requested_delta>0 THEN 'AVAILABLE' ELSE 'ADJUSTMENT_OFFSET' END,abs(adj.requested_delta),'ADJUSTMENT',p_key,p->>'reason');
      END IF;
      UPDATE stock_adjustment_requests SET state='APPROVED',approver_id=current_user_id(),decided_at=tenant_now(),revision=revision+1 WHERE tenant_id=t AND id=adj.id;
      result:=jsonb_build_object('id',adj.id,'state','APPROVED','revision',adj.revision+1);
    ELSE
      SELECT * INTO b FROM inventory_batches WHERE tenant_id=t AND id=p_id FOR UPDATE;IF b.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
      IF length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
      IF p_action='release-hold' THEN
        IF p->>'inspection_passed' IS DISTINCT FROM 'true' THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED');END IF;
        IF p->>'expiry_at' IS NOT NULL THEN
          IF b.expires_at IS NOT NULL AND (p->>'expiry_at')::timestamptz>b.expires_at THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED');END IF;
          UPDATE inventory_batches SET expires_at=(p->>'expiry_at')::timestamptz WHERE tenant_id=t AND id=b.id RETURNING * INTO b;
        END IF;
        IF b.restriction='RECALL_HOLD' OR least(b.expires_at,b.handling_deadline)<=tenant_now() OR least(b.expires_at,b.handling_deadline) IS NULL THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED');END IF;
        PERFORM post_stock_transfer(b.id,'QUARANTINE','AVAILABLE',(p->>'quantity')::numeric,'QUARANTINE_RELEASE',p_key,p->>'reason');
        IF coalesce((SELECT qty FROM batch_balances WHERE tenant_id=t AND batch_id=b.id AND account='QUARANTINE'),0)=0 THEN UPDATE inventory_batches SET restriction='NONE',condition='GOOD' WHERE tenant_id=t AND id=b.id;END IF;
      ELSIF p_action='return' THEN
        IF p->>'arrived' IS DISTINCT FROM 'true' OR p->>'from_account' NOT IN('EXCEPTION','DELIVERED','IN_TRANSIT') THEN PERFORM lb_raise('BAD_REQUEST');END IF;
        PERFORM post_stock_transfer(b.id,p->>'from_account','QUARANTINE',(p->>'quantity')::numeric,'VERIFIED_RETURN',p_key,p->>'reason');
      ELSIF p_action='recall' THEN
        INSERT INTO recalls(tenant_id,batch_id,reason,created_by) VALUES(t,b.id,p->>'reason',current_user_id()) RETURNING id INTO v_id;
        UPDATE inventory_batches SET restriction='RECALL_HOLD' WHERE tenant_id=t AND id=b.id;
        INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'RECALL','BATCH',b.id,'CRITICAL','recall:'||v_id,jsonb_build_object('recall_id',v_id)) ON CONFLICT DO NOTHING;
      END IF;
      result:=jsonb_build_object('id',b.id,'state',CASE WHEN p_action='recall' THEN 'RECALL_HOLD' ELSE 'RECORDED' END);
  END CASE;
  PERFORM append_audit('INVENTORY_'||upper(p_action),'INVENTORY',coalesce(p_id,(result->>'id')::uuid),(result->>'revision')::int,p->>'reason',jsonb_build_object('request',p,'result',result),NULL,result,pol.id);
  PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.inventory_command(text,uuid,jsonb,text,text) TO lumbung_app;
