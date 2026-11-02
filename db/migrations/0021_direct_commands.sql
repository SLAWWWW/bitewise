SET LOCAL search_path = lumbung, pg_temp;

CREATE FUNCTION lumbung.direct_create(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE o donation_orders; prod products; line jsonb; n int:=0; qty numeric;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM source_locations WHERE tenant_id=current_tenant() AND id=(p->>'source_location_id')::uuid
      AND donor_id=(p->>'donor_id')::uuid AND kind='DONOR_SITE') THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF p->>'pickup_start' IS NULL OR p->>'pickup_end' IS NULL OR (p->>'pickup_start')::timestamptz<tenant_now() OR (p->>'pickup_end')::timestamptz<=(p->>'pickup_start')::timestamptz THEN
    PERFORM lb_raise('BAD_REQUEST'); END IF;
  IF jsonb_typeof(p->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'items') NOT BETWEEN 1 AND 20 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  INSERT INTO donation_orders(tenant_id,code,donor_id,source_location_id,route,intake_channel,donation_reason,pickup_start,pickup_end,created_by)
    VALUES(current_tenant(),'DON-'||upper(substr(gen_random_uuid()::text,1,8)),(p->>'donor_id')::uuid,
      (p->>'source_location_id')::uuid,'DIRECT','MANUAL',p->>'donation_reason',(p->>'pickup_start')::timestamptz,
      (p->>'pickup_end')::timestamptz,current_user_id()) RETURNING * INTO o;
  FOR line IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
    SELECT * INTO prod FROM products WHERE tenant_id=current_tenant() AND id=(line->>'product_id')::uuid;
    IF prod.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
    qty:=(line->>'quantity')::numeric;
    IF qty IS NULL OR qty<=0 OR qty<>round(qty,3) OR mod(qty,prod.min_increment)<>0 THEN PERFORM lb_raise('QTY_INCREMENT_VIOLATION'); END IF;
    IF line->>'unit' IS DISTINCT FROM prod.base_unit THEN PERFORM lb_raise('CONVERSION_MISSING'); END IF;
    IF line->>'distribute_by' IS NULL OR (line->>'distribute_by')::timestamptz<=o.pickup_start THEN PERFORM lb_raise('FOOD_WINDOW_EXCEEDED'); END IF;
    n:=n+1;
    INSERT INTO donation_items(tenant_id,order_id,line_no,product_id,category_id,description,quantity,unit,unit_kind,
      condition,storage_req,prep_info,label_info,distribute_by,created_by)
      VALUES(current_tenant(),o.id,n,prod.id,prod.category_id,prod.name,qty,prod.base_unit,prod.unit_kind,
        line->>'condition',prod.storage_profile,coalesce(line->'prep_info','{}'),coalesce(line->'label_info','{}'),
        (line->>'distribute_by')::timestamptz,current_user_id());
  END LOOP;
  RETURN jsonb_build_object('id',o.id,'revision',o.revision,'state',o.operational_state);
END $$;

CREATE FUNCTION lumbung.direct_validate(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE o donation_orders; i record; pol policy_versions; verdict text; reasons text[]; until_at timestamptz;
  cat text; profile jsonb; all_clear boolean:=true; missing boolean:=false;
BEGIN
  PERFORM 1 FROM donation_items WHERE tenant_id=current_tenant() AND order_id=p_id ORDER BY id FOR UPDATE;
  SELECT * INTO o FROM donation_orders WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;
  IF o.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF o.revision<>(p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  IF o.operational_state NOT IN('DRAFT','NEEDS_INFO','SAFETY_REVIEW','READY') THEN PERFORM lb_raise('INVALID_STATE'); END IF;
  pol:=direct_policy('SAFETY');
  FOR i IN SELECT * FROM donation_items WHERE tenant_id=current_tenant() AND order_id=p_id ORDER BY id FOR UPDATE LOOP
    verdict:='CLEARED'; reasons:='{}'; until_at:=i.distribute_by;
    SELECT code INTO cat FROM categories WHERE tenant_id=current_tenant() AND id=i.category_id;
    profile:=pol.body->'profiles'->cat;
    IF i.quantity IS NULL OR i.unit IS NULL OR i.distribute_by IS NULL OR i.condition IS NULL THEN
      verdict:='REVIEW_REQUIRED'; reasons:=array_append(reasons,'MISSING_REQUIRED_FIELDS'); missing:=true;
    END IF;
    IF i.condition IS DISTINCT FROM 'GOOD' THEN verdict:='REVIEW_REQUIRED'; reasons:=array_append(reasons,'CONDITION_REVIEW'); END IF;
    IF i.condition IN('SPOILED','INNER_SEAL_DAMAGED') THEN verdict:='REJECTED'; reasons:=array_append(reasons,'UNSAFE_CONDITION'); END IF;
    IF profile ? 'max_hours_from_ready' THEN
      IF i.prep_info->>'ready_at' IS NULL THEN
        IF verdict<>'REJECTED' THEN verdict:='REVIEW_REQUIRED'; END IF;
        reasons:=array_append(reasons,'PREPARATION_DETAILS_UNKNOWN');
      ELSE
        until_at:=least(until_at,(i.prep_info->>'ready_at')::timestamptz+make_interval(hours=>(profile->>'max_hours_from_ready')::int));
        IF (i.prep_info->>'ready_at')::timestamptz>tenant_now() THEN verdict:='REVIEW_REQUIRED'; reasons:=array_append(reasons,'READY_TIME_IN_FUTURE'); END IF;
      END IF;
    END IF;
    IF coalesce((profile->>'requires_label_expiry')::boolean,false) THEN
      IF i.label_info->>'expiry_at' IS NULL THEN
        IF verdict<>'REJECTED' THEN verdict:='REVIEW_REQUIRED'; END IF;
        reasons:=array_append(reasons,'LABEL_EXPIRY_UNKNOWN');
      ELSE until_at:=least(until_at,(i.label_info->>'expiry_at')::timestamptz); END IF;
    END IF;
    IF cat='PREPARED_MEAL' AND (i.prep_info->>'handling_confirmed') IS DISTINCT FROM 'true' THEN
      IF verdict<>'REJECTED' THEN verdict:='REVIEW_REQUIRED'; END IF;
      reasons:=array_append(reasons,'HANDLING_DETAILS_UNKNOWN');
    END IF;
    IF until_at<=tenant_now()+make_interval(hours=>(pol.body->>'min_handling_hours')::int) THEN
      verdict:='REJECTED'; reasons:=array_append(reasons,'FOOD_WINDOW_EXCEEDED'); END IF;
    INSERT INTO safety_evaluations(tenant_id,subject_type,subject_id,policy_version_id,inputs_hash,
      deterministic_verdict,verdict,reasons,usable_until,created_by)
      VALUES(current_tenant(),'ITEM',i.id,pol.id,canonical_hash(to_jsonb(i)),verdict,verdict,reasons,until_at,current_user_id());
    UPDATE donation_items SET safety_state=verdict,distribute_by=until_at,revision=revision+1,missing_fields=reasons
      WHERE tenant_id=current_tenant() AND id=i.id;
    all_clear:=all_clear AND verdict='CLEARED';
  END LOOP;
  UPDATE donation_orders SET operational_state=CASE WHEN all_clear THEN 'READY' WHEN missing THEN 'NEEDS_INFO' ELSE 'SAFETY_REVIEW' END,
    revision=revision+1,updated_at=tenant_now() WHERE tenant_id=current_tenant() AND id=p_id RETURNING * INTO o;
  RETURN jsonb_build_object('id',o.id,'state',o.operational_state,'revision',o.revision);
END $$;

CREATE FUNCTION lumbung.direct_campaign(p_run uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE r allocation_runs; c outreach_campaigns; i donation_items; o donation_orders; line jsonb; n int:=0; chosen jsonb;
BEGIN
  SELECT * INTO r FROM allocation_runs WHERE tenant_id=current_tenant() AND id=p_run;
  IF r.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  SELECT * INTO i FROM donation_items WHERE tenant_id=current_tenant() AND id=r.item_id FOR UPDATE;
  SELECT * INTO o FROM donation_orders WHERE tenant_id=current_tenant() AND id=i.order_id;
  IF i.revision<>r.item_revision THEN PERFORM lb_raise('APPROVAL_STALE'); END IF;
  chosen:=coalesce(p->'lines',r.result->'selected');
  IF jsonb_array_length(chosen) NOT BETWEEN 1 AND 3 THEN PERFORM lb_raise('STOCK_UNAVAILABLE'); END IF;
  IF p ? 'lines' AND length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  IF (SELECT sum((x->>'quantity')::numeric) FROM jsonb_array_elements(chosen) x)>
    i.quantity-coalesce((SELECT sum(quantity) FROM allocations WHERE tenant_id=current_tenant() AND item_id=i.id
      AND state NOT IN('PROPOSED','CANCELLED','EXPIRED','EXCEPTION')),0) THEN PERFORM lb_raise('STOCK_UNAVAILABLE'); END IF;
  INSERT INTO outreach_campaigns(tenant_id,item_id,source_type,allocation_run_id,state,response_window_min,expansion_bands,template_version,created_by)
    VALUES(current_tenant(),i.id,'DIRECT_ITEM',r.id,'AWAITING_APPROVAL',15,ARRAY['SOURCE_CLUSTER','5_KM','10_KM','20_KM'],'OFFER-ID-1',current_user_id()) RETURNING * INTO c;
  FOR line IN SELECT * FROM jsonb_array_elements(chosen) LOOP
    n:=n+1;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements((r.result->'selected')||(r.result->'alternatives')) candidate
      WHERE candidate->>'flo_id'=line->>'flo_id') THEN PERFORM lb_raise('POLICY_VIOLATION'); END IF;
    IF EXISTS(SELECT 1 FROM products WHERE tenant_id=current_tenant() AND id=i.product_id AND mod((line->>'quantity')::numeric,min_increment)<>0) THEN
      PERFORM lb_raise('QTY_INCREMENT_VIOLATION'); END IF;
    IF cardinality(direct_eligibility(i.id,(line->>'flo_id')::uuid,(r.feature_snapshot->>'receipt_at')::timestamptz,
      (r.feature_snapshot->>'distribution_at')::timestamptz))>0 THEN PERFORM lb_raise('APPROVAL_STALE'); END IF;
    IF (line->>'quantity')::numeric>direct_remaining_capacity(i.id,(line->>'flo_id')::uuid,
      (r.feature_snapshot->>'service_date')::date) THEN PERFORM lb_raise('CAPACITY_EXCEEDED'); END IF;
    INSERT INTO campaign_lines(tenant_id,campaign_id,campaign_revision,flo_id,wave_no,rank,max_qty,unit,receiving_start,receiving_end,distribution_deadline,planned_receipt_at)
      VALUES(current_tenant(),c.id,1,(line->>'flo_id')::uuid,1,n,(line->>'quantity')::numeric,i.unit,
        (r.feature_snapshot->>'receipt_at')::timestamptz,(r.feature_snapshot->>'receipt_at')::timestamptz+interval '30 minutes',
        (r.feature_snapshot->>'distribution_at')::timestamptz,(r.feature_snapshot->>'receipt_at')::timestamptz);
  END LOOP;
  UPDATE outreach_campaigns SET plan_hash=canonical_hash(jsonb_build_object('run',r.facts_hash,'item_revision',i.revision,'lines',chosen,'override_reason',p->>'reason'))
    WHERE tenant_id=current_tenant() AND id=c.id RETURNING * INTO c;
  RETURN jsonb_build_object('id',c.id,'revision',c.revision,'state',c.state);
END $$;

CREATE FUNCTION lumbung.direct_approve_outreach(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE c outreach_campaigns; i donation_items; r allocation_runs;
BEGIN
  SELECT * INTO c FROM outreach_campaigns WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;
  IF c.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF c.revision<>(p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  IF c.state<>'AWAITING_APPROVAL' THEN PERFORM lb_raise('INVALID_STATE'); END IF;
  SELECT * INTO i FROM donation_items WHERE tenant_id=current_tenant() AND id=c.item_id;
  SELECT * INTO r FROM allocation_runs WHERE tenant_id=current_tenant() AND id=c.allocation_run_id;
  IF r.item_revision<>i.revision THEN PERFORM lb_raise('APPROVAL_STALE'); END IF;
  IF NOT EXISTS(SELECT 1 FROM tenant_active_policies WHERE tenant_id=current_tenant() AND kind='ALLOCATION' AND policy_version_id=r.policy_version_id) THEN
    PERFORM lb_raise('APPROVAL_STALE'); END IF;
  INSERT INTO approvals(tenant_id,stage,subject_type,subject_id,subject_revision,input_hash,approver_id,approved_at,expires_at,reason)
    VALUES(current_tenant(),'OUTREACH','CAMPAIGN',c.id,c.revision,c.plan_hash,current_user_id(),tenant_now(),
      least(i.distribute_by,tenant_now()+interval '4 hours'),p->>'reason');
  UPDATE outreach_campaigns SET state='APPROVED' WHERE tenant_id=current_tenant() AND id=c.id;
  RETURN jsonb_build_object('id',c.id,'revision',c.revision,'state','APPROVED');
END $$;

CREATE FUNCTION lumbung.direct_start(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE c outreach_campaigns; i donation_items; o donation_orders; line record; a allocations; ofr offers;
  rid uuid; obid uuid; contact uuid; used numeric; cap numeric; codes text[]; deadline timestamptz; n int:=0; tz text;
BEGIN
  -- Every direct command serialises on the source before touching recipient capacity.
  SELECT i0.* INTO i FROM donation_items i0 JOIN outreach_campaigns c0 ON c0.tenant_id=i0.tenant_id AND c0.item_id=i0.id
    WHERE c0.tenant_id=current_tenant() AND c0.id=p_id FOR UPDATE OF i0;
  SELECT * INTO c FROM outreach_campaigns WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;
  IF c.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF c.revision<>(p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  IF c.state<>'APPROVED' THEN PERFORM lb_raise('OUTREACH_APPROVAL_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM approvals WHERE tenant_id=current_tenant() AND subject_id=c.id AND stage='OUTREACH'
      AND subject_revision=c.revision AND input_hash=c.plan_hash AND invalidated_at IS NULL AND expires_at>tenant_now()) THEN
    PERFORM lb_raise('OUTREACH_APPROVAL_REQUIRED'); END IF;
  IF NOT EXISTS(SELECT 1 FROM allocation_runs WHERE tenant_id=current_tenant() AND id=c.allocation_run_id AND item_revision=i.revision) THEN
    PERFORM lb_raise('APPROVAL_STALE'); END IF;
  SELECT * INTO o FROM donation_orders WHERE tenant_id=current_tenant() AND id=i.order_id;
  SELECT timezone INTO tz FROM tenants WHERE id=current_tenant();
  PERFORM 1 FROM flo_category_capacities WHERE tenant_id=current_tenant() AND category_id=i.category_id
    AND flo_id IN(SELECT flo_id FROM campaign_lines WHERE tenant_id=current_tenant() AND campaign_id=c.id) ORDER BY id FOR UPDATE;
  SELECT coalesce(sum(quantity),0) INTO used FROM allocations WHERE tenant_id=current_tenant() AND item_id=i.id
    AND state NOT IN('PROPOSED','CANCELLED','EXPIRED','EXCEPTION');
  FOR line IN SELECT * FROM campaign_lines WHERE tenant_id=current_tenant() AND campaign_id=c.id AND campaign_revision=c.revision ORDER BY rank LOOP
    IF n>=3 THEN PERFORM lb_raise('POLICY_VIOLATION'); END IF;
    PERFORM lock_direct_recipient(line.flo_id,i.category_id);
    codes:=direct_eligibility(i.id,line.flo_id,line.planned_receipt_at,line.distribution_deadline);
    IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1],jsonb_build_object('reasons',codes)); END IF;
    IF NOT direct_window_open(line.flo_id,'CONTACT',tenant_now()) THEN PERFORM lb_raise('CONTACT_CLOSED'); END IF;
    cap:=direct_remaining_capacity(i.id,line.flo_id,(line.distribution_deadline AT TIME ZONE tz)::date);
    IF cap<line.max_qty THEN PERFORM lb_raise('CAPACITY_EXCEEDED'); END IF;
    IF EXISTS(SELECT 1 FROM products WHERE tenant_id=current_tenant() AND id=i.product_id AND mod(line.max_qty,min_increment)<>0) THEN
      PERFORM lb_raise('QTY_INCREMENT_VIOLATION'); END IF;
    IF used+line.max_qty>i.quantity THEN PERFORM lb_raise('STOCK_UNAVAILABLE'); END IF;
    deadline:=least(tenant_now()+make_interval(mins=>c.response_window_min),o.pickup_end,
      line.planned_receipt_at-make_interval(mins=>(direct_travel(i.id,line.flo_id)->>'minutes')::int));
    IF deadline<=tenant_now() OR NOT direct_window_open(line.flo_id,'CONTACT',deadline) THEN PERFORM lb_raise('FOOD_WINDOW_EXCEEDED'); END IF;
    SELECT id INTO contact FROM flo_contacts WHERE tenant_id=current_tenant() AND flo_id=line.flo_id
      AND channel='SIM' AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL ORDER BY id LIMIT 1;
    INSERT INTO allocations(tenant_id,code,item_id,source_type,flo_id,category_id,quantity,unit,unit_kind,state,chosen_run_id,campaign_id,
      planned_pickup_start,planned_pickup_end,planned_receipt_at,planned_distribution_at,planned_service_date)
      VALUES(current_tenant(),'AL-'||upper(substr(gen_random_uuid()::text,1,8)),i.id,'DIRECT_ITEM',line.flo_id,i.category_id,
        line.max_qty,i.unit,i.unit_kind,'OFFER_HELD',c.allocation_run_id,c.id,o.pickup_start,o.pickup_end,line.planned_receipt_at,
        line.distribution_deadline,(line.distribution_deadline AT TIME ZONE tz)::date) RETURNING * INTO a;
    INSERT INTO offers(tenant_id,code,campaign_id,campaign_line_id,campaign_revision,allocation_id,flo_id,contact_id,quantity,unit,state,expires_at,queued_at)
      VALUES(current_tenant(),'OF-'||upper(substr(gen_random_uuid()::text,1,8)),c.id,line.id,c.revision,a.id,line.flo_id,contact,line.max_qty,i.unit,
        'QUEUED',deadline,tenant_now()) RETURNING * INTO ofr;
    INSERT INTO reservations(tenant_id,kind,source_type,allocation_id,offer_id,expires_at)
      VALUES(current_tenant(),'HOLD','DIRECT_ITEM',a.id,ofr.id,deadline) RETURNING id INTO rid;
    INSERT INTO reservation_lines(tenant_id,reservation_id,item_id,quantity,unit) VALUES(current_tenant(),rid,i.id,line.max_qty,i.unit);
    INSERT INTO outbox(tenant_id,kind,dedupe_key,payload,purpose,locale,template,expires_at)
      VALUES(current_tenant(),'MESSAGE','offer:'||ofr.id,jsonb_build_object('offer_id',ofr.id,'contact_id',contact,'text',
        'Bu/Pak, tersedia '||line.max_qty||' '||i.unit||' '||i.description||', referensi '||ofr.code||'. Ongkir ditanggung FLO. Menunggu konfirmasi dan persetujuan akhir FoodCycle.'),
        'APPROVED_OFFER','id',c.template_version,deadline) RETURNING id INTO obid;
    UPDATE offers SET outbox_id=obid WHERE tenant_id=current_tenant() AND id=ofr.id;
    INSERT INTO jobs(tenant_id,kind,subject_type,subject_id,dedup_key,run_at)
      VALUES(current_tenant(),'OFFER_EXPIRY','OFFER',ofr.id,'offer-expiry:'||ofr.id,deadline);
    used:=used+line.max_qty; n:=n+1;
  END LOOP;
  UPDATE outreach_campaigns SET state='RUNNING' WHERE tenant_id=current_tenant() AND id=c.id;
  UPDATE donation_orders SET operational_state='ALLOCATING',revision=revision+1 WHERE tenant_id=current_tenant() AND id=o.id;
  RETURN jsonb_build_object('id',c.id,'state','RUNNING','offers_created',n,'revision',c.revision);
END $$;

CREATE FUNCTION lumbung.direct_respond(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE ofr offers; a allocations; i donation_items; qty numeric; rid uuid; ttl int; codes text[]; expires timestamptz;
BEGIN
  SELECT i0.* INTO i FROM donation_items i0 JOIN allocations a0 ON a0.tenant_id=i0.tenant_id AND a0.item_id=i0.id
    JOIN offers f0 ON f0.tenant_id=a0.tenant_id AND f0.allocation_id=a0.id
    WHERE f0.tenant_id=current_tenant() AND f0.id=p_id FOR UPDATE OF i0;
  SELECT * INTO ofr FROM offers WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;
  IF ofr.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF ofr.revision<>(p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  IF ofr.expires_at<=tenant_now() THEN PERFORM lb_raise('OFFER_EXPIRED'); END IF;
  IF ofr.state NOT IN('SENT','DELIVERED') THEN PERFORM lb_raise('INVALID_STATE'); END IF;
  SELECT * INTO a FROM allocations WHERE tenant_id=current_tenant() AND id=ofr.allocation_id FOR UPDATE;
  PERFORM lock_direct_recipient(a.flo_id,a.category_id);
  IF p->>'response'='DECLINE' THEN
    PERFORM direct_release(a.id,coalesce(p->>'reason','OTHER'));
    UPDATE offers SET state='DECLINED',response_kind='DECLINE',decline_reason_code=p->>'reason',responded_at=tenant_now(),
      r_eligible=delivery_receipt_at IS NOT NULL,r_timely=delivery_receipt_at IS NOT NULL AND tenant_now()<=response_deadline,revision=revision+1
      ,r_exclusion=CASE WHEN delivery_receipt_at IS NULL THEN 'NO_DELIVERY_RECEIPT' ELSE NULL END
      WHERE tenant_id=current_tenant() AND id=p_id;
    RETURN jsonb_build_object('id',p_id,'state','DECLINED');
  END IF;
  IF p->>'response' NOT IN('ACCEPT','PARTIAL_ACCEPT') THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  codes:=direct_eligibility(i.id,a.flo_id,a.planned_receipt_at,a.planned_distribution_at);
  IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1]); END IF;
  qty:=(p->>'quantity')::numeric;
  IF qty IS NULL OR qty<=0 OR qty>ofr.quantity OR (p->>'response'='ACCEPT' AND qty<>ofr.quantity) THEN PERFORM lb_raise('CAPACITY_EXCEEDED'); END IF;
  IF EXISTS(SELECT 1 FROM products WHERE tenant_id=current_tenant() AND id=i.product_id AND mod(qty,min_increment)<>0) THEN
    PERFORM lb_raise('QTY_INCREMENT_VIOLATION'); END IF;
  SELECT id INTO rid FROM reservations WHERE tenant_id=current_tenant() AND offer_id=ofr.id AND state='ACTIVE' FOR UPDATE;
  IF rid IS NULL THEN PERFORM lb_raise('OFFER_EXPIRED'); END IF;
  ttl:=CASE WHEN i.distribute_by<tenant_now()+interval '1 day' THEN 15 ELSE 120 END;
  expires:=least(tenant_now()+make_interval(mins=>ttl),a.planned_pickup_end,
    a.planned_receipt_at-make_interval(mins=>(direct_travel(i.id,a.flo_id)->>'minutes')::int));
  IF expires<=tenant_now() THEN PERFORM lb_raise('FOOD_WINDOW_EXCEEDED'); END IF;
  UPDATE reservation_lines SET quantity=qty WHERE tenant_id=current_tenant() AND reservation_id=rid AND state='ACTIVE';
  UPDATE reservations SET kind='RESERVATION',expires_at=expires,revision=revision+1 WHERE tenant_id=current_tenant() AND id=rid;
  UPDATE allocations SET quantity=qty,state='ACCEPTED_RESERVED',revision=revision+1 WHERE tenant_id=current_tenant() AND id=a.id;
  UPDATE offers SET state=CASE WHEN qty<quantity THEN 'PARTIALLY_ACCEPTED' ELSE 'ACCEPTED' END,accepted_qty=qty,
    response_kind=p->>'response',responded_at=tenant_now(),r_eligible=delivery_receipt_at IS NOT NULL,
    r_timely=delivery_receipt_at IS NOT NULL AND tenant_now()<=response_deadline,revision=revision+1
    WHERE tenant_id=current_tenant() AND id=p_id;
  INSERT INTO jobs(tenant_id,kind,subject_type,subject_id,dedup_key,run_at)
    VALUES(current_tenant(),'RESERVATION_EXPIRY','ALLOCATION',a.id,'reservation-expiry:'||rid,expires);
  RETURN jsonb_build_object('id',p_id,'allocation_id',a.id,'quantity',qty::text,'state','ACCEPTED_RESERVED');
END $$;

CREATE FUNCTION lumbung.direct_transport(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE a allocations; contact uuid; status text;
BEGIN
  SELECT * INTO a FROM allocations WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;
  IF a.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF a.revision<>(p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  IF a.state NOT IN('ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED') THEN PERFORM lb_raise('INVALID_STATE'); END IF;
  SELECT id INTO contact FROM flo_contacts WHERE tenant_id=current_tenant() AND id=(p->>'contact_id')::uuid AND flo_id=a.flo_id
    AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL;
  IF contact IS NULL THEN PERFORM lb_raise('CONTACT_UNAUTHORISED'); END IF;
  IF p->>'decision' NOT IN('ACCEPT','REFUSE') OR p->>'method' NOT IN('SELF_PICKUP','FLO_BOOKED_COURIER','FOODCYCLE_COORDINATED_COURIER') THEN
    PERFORM lb_raise('BAD_REQUEST'); END IF;
  IF p->>'decision'='REFUSE' AND p->>'method'='SELF_PICKUP' THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  IF p->>'method'<>'SELF_PICKUP' AND p->>'decision'='ACCEPT' AND (p->>'fee_idr' IS NULL OR (p->>'fee_idr')::int<0) THEN
    PERFORM lb_raise('TRANSPORT_UNCONFIRMED'); END IF;
  status:=CASE WHEN p->>'decision'='REFUSE' THEN 'REFUSED' WHEN p->>'method'='SELF_PICKUP' THEN 'NOT_APPLICABLE' ELSE 'CONFIRMED' END;
  INSERT INTO transport_arrangements(tenant_id,allocation_id,method,arranger,payer,quote_status,confirmed_fee_idr,fee_accepted_at,fee_accepted_contact_id,fee_refused_at)
    VALUES(current_tenant(),a.id,p->>'method',p->>'arranger','FLO',status,
      CASE WHEN p->>'method'='SELF_PICKUP' THEN NULL ELSE (p->>'fee_idr')::int END,
      CASE WHEN status<>'REFUSED' THEN tenant_now() END,contact,CASE WHEN status='REFUSED' THEN tenant_now() END)
    ON CONFLICT(tenant_id,allocation_id) DO UPDATE SET method=excluded.method,arranger=excluded.arranger,quote_status=excluded.quote_status,
      confirmed_fee_idr=excluded.confirmed_fee_idr,fee_accepted_at=excluded.fee_accepted_at,fee_accepted_contact_id=excluded.fee_accepted_contact_id,
      fee_refused_at=excluded.fee_refused_at,revision=transport_arrangements.revision+1;
  UPDATE approvals SET invalidated_at=tenant_now(),invalidated_reason='TRANSPORT_CHANGED'
    WHERE tenant_id=current_tenant() AND subject_id=a.id AND stage='FINAL_DISPATCH' AND invalidated_at IS NULL;
  UPDATE allocations SET state=CASE WHEN status='REFUSED' THEN 'LOGISTICS_PENDING' ELSE 'AWAITING_FINAL_APPROVAL' END,
    revision=revision+1 WHERE tenant_id=current_tenant() AND id=a.id RETURNING * INTO a;
  IF status='REFUSED' THEN
    PERFORM direct_release(a.id,'FEE_UNAFFORDABLE');
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload)
      VALUES(current_tenant(),'LOGISTICS_REVIEW','ALLOCATION',a.id,'MEDIUM','OPEN','fee-refused:'||a.id||':'||a.revision,
        '{"reason":"FEE_UNAFFORDABLE","reporting_penalty":false}');
    SELECT * INTO a FROM allocations WHERE tenant_id=current_tenant() AND id=p_id;
  END IF;
  RETURN jsonb_build_object('id',a.id,'state',a.state,'revision',a.revision);
END $$;

CREATE FUNCTION lumbung.direct_dispatch_hash(p_allocation uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = lumbung, pg_temp AS $$
  SELECT canonical_hash(jsonb_build_object('allocation',to_jsonb(a)-ARRAY['state','updated_at'],
    'item',to_jsonb(i),'transport',to_jsonb(t),'safety_policy',s.policy_version_id))
    FROM allocations a JOIN donation_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id
    JOIN transport_arrangements t ON t.tenant_id=a.tenant_id AND t.allocation_id=a.id
    JOIN tenant_active_policies s ON s.tenant_id=a.tenant_id AND s.kind='SAFETY'
    WHERE a.tenant_id=current_tenant() AND a.id=p_allocation
$$;

CREATE FUNCTION lumbung.direct_approve_dispatch(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE a allocations; i donation_items; o donation_orders; d deliveries; codes text[]; expiry timestamptz;
BEGIN
  SELECT * INTO a FROM allocations WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;
  IF a.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF a.revision<>(p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  IF a.state<>'AWAITING_FINAL_APPROVAL' THEN PERFORM lb_raise('INVALID_STATE'); END IF;
  PERFORM lock_direct_recipient(a.flo_id,a.category_id);
  codes:=direct_eligibility(a.item_id,a.flo_id,a.planned_receipt_at,a.planned_distribution_at);
  IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1]); END IF;
  IF NOT EXISTS(SELECT 1 FROM transport_arrangements WHERE tenant_id=current_tenant() AND allocation_id=a.id AND payer='FLO'
      AND quote_status IN('CONFIRMED','NOT_APPLICABLE') AND fee_accepted_at IS NOT NULL AND fee_refused_at IS NULL) THEN
    PERFORM lb_raise('TRANSPORT_UNCONFIRMED'); END IF;
  SELECT expires_at INTO expiry FROM reservations WHERE tenant_id=current_tenant() AND allocation_id=a.id
    AND kind='RESERVATION' AND state='ACTIVE' AND expires_at>tenant_now() ORDER BY id LIMIT 1;
  IF expiry IS NULL THEN PERFORM lb_raise('OFFER_EXPIRED'); END IF;
  SELECT * INTO i FROM donation_items WHERE tenant_id=current_tenant() AND id=a.item_id;
  SELECT * INTO o FROM donation_orders WHERE tenant_id=current_tenant() AND id=i.order_id;
  INSERT INTO approvals(tenant_id,stage,subject_type,subject_id,subject_revision,input_hash,approver_id,approved_at,expires_at,reason)
    VALUES(current_tenant(),'FINAL_DISPATCH','ALLOCATION',a.id,a.revision,direct_dispatch_hash(a.id),current_user_id(),tenant_now(),expiry,p->>'reason');
  SELECT d0.* INTO d FROM deliveries d0 JOIN delivery_lines dl ON dl.tenant_id=d0.tenant_id AND dl.delivery_id=d0.id
    WHERE dl.tenant_id=current_tenant() AND dl.allocation_id=a.id LIMIT 1;
  IF d.id IS NULL THEN
    INSERT INTO deliveries(tenant_id,code,route,source_location_id,destination_flo_id,state,planned_pickup_at,planned_arrival_at)
      VALUES(current_tenant(),'DO-'||upper(substr(gen_random_uuid()::text,1,8)),'DIRECT',o.source_location_id,a.flo_id,
        'READY_FOR_PICKUP',a.planned_pickup_start,a.planned_receipt_at) RETURNING * INTO d;
    INSERT INTO delivery_lines(tenant_id,delivery_id,allocation_id,item_id,product_id,category_id,unit,unit_kind,offered_qty,allocated_qty)
      VALUES(current_tenant(),d.id,a.id,i.id,i.product_id,i.category_id,i.unit,i.unit_kind,
        (SELECT quantity FROM offers WHERE tenant_id=current_tenant() AND allocation_id=a.id ORDER BY id LIMIT 1),a.quantity);
  ELSE
    UPDATE delivery_lines SET allocated_qty=a.quantity WHERE tenant_id=current_tenant() AND delivery_id=d.id;
  END IF;
  UPDATE allocations SET state='APPROVED' WHERE tenant_id=current_tenant() AND id=a.id;
  RETURN jsonb_build_object('id',a.id,'state','APPROVED','revision',a.revision,'delivery_id',d.id);
END $$;

CREATE FUNCTION lumbung.direct_dispatch(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE d deliveries; a allocations; i donation_items; codes text[]; dl delivery_lines; r reservations; pol policy_versions; tz text; due timestamptz; rule text;
BEGIN
  SELECT i0.* INTO i FROM donation_items i0 JOIN delivery_lines dl0 ON dl0.tenant_id=i0.tenant_id AND dl0.item_id=i0.id
    WHERE dl0.tenant_id=current_tenant() AND dl0.delivery_id=p_id ORDER BY i0.id LIMIT 1 FOR UPDATE OF i0;
  SELECT * INTO d FROM deliveries WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;
  IF d.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF d.revision<>(p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  IF d.route<>'DIRECT' OR d.state<>'READY_FOR_PICKUP' THEN PERFORM lb_raise('INVALID_STATE'); END IF;
  FOR dl IN SELECT * FROM delivery_lines WHERE tenant_id=current_tenant() AND delivery_id=d.id ORDER BY allocation_id LOOP
    SELECT * INTO a FROM allocations WHERE tenant_id=current_tenant() AND id=dl.allocation_id FOR UPDATE;
    PERFORM lock_direct_recipient(a.flo_id,a.category_id);
    IF a.state<>'APPROVED' OR NOT EXISTS(SELECT 1 FROM approvals WHERE tenant_id=current_tenant() AND subject_id=a.id AND stage='FINAL_DISPATCH'
      AND subject_revision=a.revision AND input_hash=direct_dispatch_hash(a.id) AND invalidated_at IS NULL AND expires_at>tenant_now()) THEN
      PERFORM lb_raise('DISPATCH_APPROVAL_REQUIRED'); END IF;
    codes:=direct_eligibility(a.item_id,a.flo_id,a.planned_receipt_at,a.planned_distribution_at);
    IF cardinality(codes)>0 THEN PERFORM lb_raise(codes[1]); END IF;
    IF tenant_now()<a.planned_pickup_start OR tenant_now()>=a.planned_pickup_end THEN PERFORM lb_raise('FOOD_WINDOW_EXCEEDED'); END IF;
    SELECT * INTO r FROM reservations WHERE tenant_id=current_tenant() AND allocation_id=a.id AND kind='RESERVATION'
      AND state='ACTIVE' AND expires_at>tenant_now() ORDER BY id LIMIT 1 FOR UPDATE;
    IF r.id IS NULL THEN PERFORM lb_raise('OFFER_EXPIRED'); END IF;
    IF (SELECT sum(quantity) FROM allocations WHERE tenant_id=current_tenant() AND item_id=i.id
      AND state NOT IN('PROPOSED','CANCELLED','EXPIRED','EXCEPTION'))>i.quantity THEN PERFORM lb_raise('STOCK_UNAVAILABLE'); END IF;
    IF (SELECT sum(quantity) FROM reservation_lines WHERE tenant_id=current_tenant() AND reservation_id=r.id AND state='ACTIVE') IS DISTINCT FROM a.quantity THEN
      PERFORM lb_raise('STOCK_UNAVAILABLE'); END IF;
    UPDATE reservations SET state='CONSUMED' WHERE tenant_id=current_tenant() AND id=r.id;
    UPDATE reservation_lines SET state='CONSUMED' WHERE tenant_id=current_tenant() AND reservation_id=r.id;
    UPDATE allocations SET state='DISPATCHED' WHERE tenant_id=current_tenant() AND id=a.id;
    UPDATE delivery_lines SET dispatched_qty=a.quantity,picked_qty=a.quantity WHERE tenant_id=current_tenant() AND id=dl.id;
  END LOOP;
  UPDATE deliveries SET state='IN_TRANSIT',custodian=p->>'custodian',picked_up_at=tenant_now(),dispatched_at=tenant_now(),revision=revision+1
    WHERE tenant_id=current_tenant() AND id=d.id RETURNING * INTO d;
  pol:=direct_policy('REPORTING');
  SELECT timezone INTO tz FROM tenants WHERE id=current_tenant();
  rule:=pol.body->'due_rules'->>'RECEIPT_PHOTO';
  due:=CASE WHEN rule='ROLLING_24H' THEN tenant_now()+interval '24 hours'
    ELSE ((tenant_now() AT TIME ZONE tz)::date+2)::timestamp AT TIME ZONE tz - interval '1 microsecond' END;
  INSERT INTO evidence_obligations(tenant_id,type,subject_type,subject_id,anchor_kind,anchor_at,due_at,due_rule,timezone,policy_version_id)
    VALUES(current_tenant(),'RECEIPT_PHOTO','DELIVERY',d.id,'DISPATCH',tenant_now(),due,rule,tz,pol.id);
  RETURN jsonb_build_object('id',d.id,'state',d.state,'revision',d.revision);
END $$;

CREATE FUNCTION lumbung.direct_receive(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE d deliveries; dl delivery_lines; rid uuid; accepted numeric; rejected numeric; pol policy_versions; tz text;
BEGIN
  SELECT * INTO d FROM deliveries WHERE tenant_id=current_tenant() AND id=p_id FOR UPDATE;
  IF d.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF d.revision<>(p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  IF d.route<>'DIRECT' OR d.state<>'IN_TRANSIT' THEN PERFORM lb_raise('INVALID_STATE'); END IF;
  IF (SELECT count(*) FROM delivery_lines WHERE tenant_id=current_tenant() AND delivery_id=d.id)<>1 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  SELECT * INTO dl FROM delivery_lines WHERE tenant_id=current_tenant() AND delivery_id=d.id;
  accepted:=(p->>'accepted_quantity')::numeric; rejected:=(p->>'rejected_quantity')::numeric;
  IF accepted<0 OR rejected<0 OR accepted+rejected>dl.dispatched_qty OR accepted<>round(accepted,3) OR rejected<>round(rejected,3)
      OR (dl.unit_kind='COUNT' AND (accepted<>trunc(accepted) OR rejected<>trunc(rejected))) THEN PERFORM lb_raise('RECEIPT_EXCEEDS_DISPATCHED'); END IF;
  IF accepted<>dl.dispatched_qty AND length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  INSERT INTO flo_receipts(tenant_id,delivery_id,flo_id,received_at,time_source,recorded_by_actor)
    VALUES(current_tenant(),d.id,d.destination_flo_id,tenant_now(),'STAFF_RECORDED',current_user_id()) RETURNING id INTO rid;
  INSERT INTO receipt_lines(tenant_id,receipt_id,delivery_line_id,flo_id,category_id,unit,received_at,accepted_qty,rejected_qty,discrepancy_reason)
    VALUES(current_tenant(),rid,dl.id,d.destination_flo_id,dl.category_id,dl.unit,tenant_now(),accepted,rejected,p->>'reason');
  UPDATE allocations SET state='RECEIVED' WHERE tenant_id=current_tenant() AND id=dl.allocation_id;
  UPDATE deliveries SET state=CASE WHEN accepted=dl.dispatched_qty THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END,
    received_at=tenant_now(),arrived_at=tenant_now(),custodian='FLO',revision=revision+1 WHERE tenant_id=current_tenant() AND id=d.id RETURNING * INTO d;
  IF accepted<>dl.dispatched_qty THEN
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload)
      VALUES(current_tenant(),'RECEIPT_DISCREPANCY','DELIVERY',d.id,'HIGH','OPEN','receipt-discrepancy:'||d.id,
        jsonb_build_object('accepted',accepted,'rejected',rejected,'unaccounted',dl.dispatched_qty-accepted-rejected,'reason',p->>'reason'));
  END IF;
  IF agreement_valid_at(d.destination_flo_id,tenant_now()) IS NULL THEN
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload)
      VALUES(current_tenant(),'AGREEMENT_EXPIRED_AT_HANDOVER','DELIVERY',d.id,'HIGH','OPEN','agreement-handover:'||d.id,'{}');
  END IF;
  pol:=direct_policy('REPORTING'); SELECT timezone INTO tz FROM tenants WHERE id=current_tenant();
  INSERT INTO evidence_obligations(tenant_id,type,subject_type,subject_id,anchor_kind,anchor_at,due_at,due_rule,timezone,policy_version_id)
    VALUES(current_tenant(),'BAST','DELIVERY',d.id,'RECEIPT',tenant_now(),tenant_now(),'AT_RECEIPT',tz,pol.id);
  RETURN jsonb_build_object('id',d.id,'state',d.state,'revision',d.revision,'receipt_id',rid,'accepted_quantity',accepted::text);
END $$;

-- One public command boundary. Action names select fixed functions/capabilities;
-- callers cannot PATCH state or provide SQL/function names.
CREATE FUNCTION lumbung.direct_command(p_action text,p_subject uuid,p_payload jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE cap text; result jsonb; replay jsonb; t uuid:=require_ctx(); item_to_refresh uuid; before_facts jsonb; decision jsonb;
BEGIN
  cap:=CASE p_action WHEN 'create' THEN 'donation.create' WHEN 'validate' THEN 'donation.validate'
    WHEN 'draft' THEN 'allocation.run' WHEN 'approve-outreach' THEN 'outreach.approve' WHEN 'start' THEN 'campaign.start'
    WHEN 'respond' THEN 'offer.respond' WHEN 'transport' THEN 'transport.edit' WHEN 'approve-dispatch' THEN 'dispatch.approve'
    WHEN 'dispatch' THEN 'delivery.dispatch' WHEN 'receive' THEN 'delivery.receive' WHEN 'release' THEN 'reservation.release' END;
  IF cap IS NULL THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  PERFORM require_cap(cap);
  -- FLO responses are currently simulated staff actions; scoped contact links
  -- are introduced with the reporting/mobile workflow.
  IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  IF p_action<>'create' AND NOT (
    (p_action='validate' AND EXISTS(SELECT 1 FROM donation_orders WHERE tenant_id=t AND id=p_subject)) OR
    (p_action='draft' AND EXISTS(SELECT 1 FROM allocation_runs WHERE tenant_id=t AND id=p_subject)) OR
    (p_action IN('approve-outreach','start') AND EXISTS(SELECT 1 FROM outreach_campaigns WHERE tenant_id=t AND id=p_subject)) OR
    (p_action='respond' AND EXISTS(SELECT 1 FROM offers WHERE tenant_id=t AND id=p_subject)) OR
    (p_action IN('transport','approve-dispatch','release') AND EXISTS(SELECT 1 FROM allocations WHERE tenant_id=t AND id=p_subject)) OR
    (p_action IN('dispatch','receive') AND EXISTS(SELECT 1 FROM deliveries WHERE tenant_id=t AND id=p_subject))
  ) THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  PERFORM direct_policy('SAFETY');
  IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED','{"http":400}'); END IF;
  replay:=idem_begin(p_key,'direct:'||p_action,canonical_hash(jsonb_build_object('subject',p_subject,'payload',p_payload,'hash',p_hash)));
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  before_facts:=CASE
    WHEN p_action='transport' THEN (SELECT jsonb_build_object('allocation',to_jsonb(a),'transport',to_jsonb(tr)) FROM allocations a
      LEFT JOIN transport_arrangements tr ON tr.tenant_id=a.tenant_id AND tr.allocation_id=a.id WHERE a.tenant_id=t AND a.id=p_subject)
    WHEN p_action='validate' THEN (SELECT to_jsonb(o) FROM donation_orders o WHERE o.tenant_id=t AND o.id=p_subject)
    WHEN p_action IN('approve-outreach','start') THEN (SELECT to_jsonb(c) FROM outreach_campaigns c WHERE c.tenant_id=t AND c.id=p_subject)
    WHEN p_action='respond' THEN (SELECT to_jsonb(f) FROM offers f WHERE f.tenant_id=t AND f.id=p_subject)
    WHEN p_action IN('dispatch','receive') THEN (SELECT to_jsonb(d) FROM deliveries d WHERE d.tenant_id=t AND d.id=p_subject)
    WHEN p_action IN('approve-dispatch','release') THEN (SELECT to_jsonb(a) FROM allocations a WHERE a.tenant_id=t AND a.id=p_subject)
    ELSE NULL END;
  IF p_action NOT IN('create','draft') AND (p_payload->>'expected_revision') IS NULL THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  CASE p_action
    WHEN 'create' THEN result:=direct_create(p_payload);
    WHEN 'validate' THEN result:=direct_validate(p_subject,p_payload);
    WHEN 'draft' THEN result:=direct_campaign(p_subject,p_payload);
    WHEN 'approve-outreach' THEN result:=direct_approve_outreach(p_subject,p_payload);
    WHEN 'start' THEN result:=direct_start(p_subject,p_payload);
    WHEN 'respond' THEN result:=direct_respond(p_subject,p_payload);
    WHEN 'transport' THEN result:=direct_transport(p_subject,p_payload);
    WHEN 'approve-dispatch' THEN result:=direct_approve_dispatch(p_subject,p_payload);
    WHEN 'dispatch' THEN result:=direct_dispatch(p_subject,p_payload);
    WHEN 'receive' THEN result:=direct_receive(p_subject,p_payload);
    WHEN 'release' THEN
      PERFORM 1 FROM donation_items i JOIN allocations a ON a.item_id=i.id AND a.tenant_id=i.tenant_id
        WHERE a.tenant_id=t AND a.id=p_subject FOR UPDATE OF i;
      PERFORM 1 FROM allocations WHERE tenant_id=t AND id=p_subject FOR UPDATE;
      IF NOT FOUND THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
      IF NOT EXISTS(SELECT 1 FROM allocations WHERE tenant_id=t AND id=p_subject AND revision=(p_payload->>'expected_revision')::int
        AND state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED')) THEN PERFORM lb_raise('INVALID_STATE'); END IF;
      IF length(trim(coalesce(p_payload->>'reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
      PERFORM direct_release(p_subject,p_payload->>'reason'); result:=jsonb_build_object('id',p_subject,'state','CANCELLED');
  END CASE;
  IF p_action IN('respond','transport','approve-dispatch','dispatch','receive') THEN
    item_to_refresh:=CASE
      WHEN p_action='respond' THEN (SELECT a.item_id FROM allocations a JOIN offers f ON f.allocation_id=a.id AND f.tenant_id=a.tenant_id WHERE f.tenant_id=t AND f.id=p_subject)
      WHEN p_action IN('dispatch','receive') THEN (SELECT item_id FROM delivery_lines WHERE tenant_id=t AND delivery_id=p_subject ORDER BY id LIMIT 1)
      ELSE (SELECT item_id FROM allocations WHERE tenant_id=t AND id=p_subject) END;
    PERFORM refresh_direct_order(item_to_refresh);
  END IF;
  decision:=jsonb_build_object('request',p_payload,'result',result,'before',before_facts,
    'active_policies',(SELECT jsonb_object_agg(kind,policy_version_id) FROM tenant_active_policies WHERE tenant_id=t));
  PERFORM append_audit('DIRECT_'||upper(replace(p_action,'-','_')),'DIRECT_WORKFLOW',coalesce(p_subject,(result->>'id')::uuid),
    (result->>'revision')::int,p_payload->>'reason',decision,before_facts,result,
    (SELECT policy_version_id FROM tenant_active_policies WHERE tenant_id=t AND kind='SAFETY'));
  PERFORM emit_event('DIRECT_'||upper(replace(p_action,'-','_')),'DIRECT_WORKFLOW',coalesce(p_subject,(result->>'id')::uuid),(result->>'revision')::int,result);
  PERFORM idem_complete(p_key,result);
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.direct_command(text,uuid,jsonb,text,text) TO lumbung_app;
