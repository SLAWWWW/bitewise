SET LOCAL search_path=lumbung,pg_temp;

CREATE OR REPLACE FUNCTION lumbung.direct_create(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE o donation_orders; prod products; line jsonb; n int:=0; qty numeric; factor numeric; conversion uuid;
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
    factor:=unit_factor(prod.id,line->>'unit',prod.base_unit);
    IF factor IS NULL THEN PERFORM lb_raise('CONVERSION_MISSING');END IF;
    qty:=(line->>'quantity')::numeric*factor;
    SELECT id INTO conversion FROM unit_conversions WHERE tenant_id=current_tenant() AND product_id=prod.id AND from_unit=line->>'unit' AND to_unit=prod.base_unit AND provenance IN('MEASURED','APPROVED_ESTIMATE') AND (valid_from IS NULL OR valid_from<=tenant_now()) AND (valid_to IS NULL OR tenant_now()<valid_to) ORDER BY version DESC LIMIT 1;
    IF qty IS NULL OR qty<=0 OR qty<>round(qty,3) OR mod(qty,prod.min_increment)<>0 THEN PERFORM lb_raise('QTY_INCREMENT_VIOLATION'); END IF;
    
    IF line->>'distribute_by' IS NULL OR (line->>'distribute_by')::timestamptz<=o.pickup_start THEN PERFORM lb_raise('FOOD_WINDOW_EXCEEDED'); END IF;
    n:=n+1;
    INSERT INTO donation_items(tenant_id,order_id,line_no,product_id,category_id,description,quantity,unit,unit_kind,
      condition,storage_req,prep_info,label_info,distribute_by,conversion_id,parse,created_by)
      VALUES(current_tenant(),o.id,n,prod.id,prod.category_id,prod.name,qty,prod.base_unit,prod.unit_kind,
        line->>'condition',prod.storage_profile,coalesce(line->'prep_info','{}'),coalesce(line->'label_info','{}'),
        (line->>'distribute_by')::timestamptz,conversion,jsonb_build_object('raw_quantity',line->>'quantity','raw_unit',line->>'unit','conversion_factor',factor,'conversion_id',conversion),current_user_id());
  END LOOP;
  RETURN jsonb_build_object('id',o.id,'revision',o.revision,'state',o.operational_state);
END $$;


CREATE OR REPLACE FUNCTION lumbung.respond_direct_offer(p_id uuid,p jsonb) RETURNS jsonb
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
  ttl:=CASE WHEN i.distribute_by<tenant_now()+interval '1 day' THEN coalesce(((direct_policy('LOGISTICS')).body->'reservation_ttl_minutes'->>'urgent')::int,15) ELSE coalesce(((direct_policy('LOGISTICS')).body->'reservation_ttl_minutes'->>'scheduled')::int,120) END;
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

CREATE OR REPLACE FUNCTION lumbung.direct_campaign(p_run uuid,p jsonb) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION lumbung.direct_window_open(p_flo uuid,p_kind text,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = lumbung, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM availability_windows w JOIN tenants t ON t.id=w.tenant_id
    WHERE w.tenant_id=current_tenant() AND w.flo_id=p_flo AND w.kind=p_kind
      AND w.dow=extract(isodow FROM p_at AT TIME ZONE t.timezone)
      AND (p_at AT TIME ZONE t.timezone)::time >= w.start_local
      AND (p_at AT TIME ZONE t.timezone)::time < w.end_local
  ) AND (p_kind<>'CONTACT' OR ((p_at AT TIME ZONE 'Asia/Jakarta')::time >= ((direct_policy('OUTREACH')).body->'contact_hours'->>'start')::time AND (p_at AT TIME ZONE 'Asia/Jakarta')::time < ((direct_policy('OUTREACH')).body->'contact_hours'->>'end')::time)) AND NOT EXISTS (
    SELECT 1 FROM availability_windows w WHERE w.tenant_id=current_tenant() AND w.flo_id=p_flo
      AND w.kind IN ('CLOSURE','UNAVAILABLE') AND w.starts_at<=p_at AND p_at<w.ends_at
  )
$$;
