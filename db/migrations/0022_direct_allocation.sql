SET LOCAL search_path = lumbung, pg_temp;

CREATE FUNCTION lumbung.direct_features(p_item uuid,p_receipt timestamptz,p_distribution timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE t uuid:=require_ctx(); i donation_items; pol policy_versions; tz text; day date; service date; lo timestamptz; hi timestamptz; candidates jsonb;
BEGIN
  PERFORM require_cap('allocation.run');
  SELECT * INTO i FROM donation_items WHERE tenant_id=t AND id=p_item;
  IF i.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  pol:=direct_policy('ALLOCATION');
  IF i.safety_state<>'CLEARED' THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED'); END IF;
  SELECT timezone INTO tz FROM tenants WHERE id=t;
  day:=(tenant_now() AT TIME ZONE tz)::date; service:=(p_distribution AT TIME ZONE tz)::date;
  IF service<day OR service>day+30 OR p_receipt<tenant_now() OR p_distribution<p_receipt OR p_distribution>i.distribute_by THEN
    PERFORM lb_raise('FOOD_WINDOW_EXCEEDED'); END IF;
  lo:=(day-29)::timestamp AT TIME ZONE tz; hi:=(service+1)::timestamp AT TIME ZONE tz;
  SELECT jsonb_agg(jsonb_build_object('id',f.id,'code',f.code,'name',f.name,
    'reasons',direct_eligibility(i.id,f.id,p_receipt,p_distribution),'travel',direct_travel(i.id,f.id),
    'same_cluster',EXISTS(SELECT 1 FROM flo_clusters fc JOIN donation_orders o ON o.tenant_id=fc.tenant_id AND o.id=i.order_id
      JOIN source_locations s ON s.tenant_id=o.tenant_id AND s.id=o.source_location_id
      WHERE fc.tenant_id=t AND fc.flo_id=f.id AND fc.cluster_id=s.cluster_id),
    'capacity',direct_remaining_capacity(i.id,f.id,service)::text,
    'need',(SELECT jsonb_build_object('score',n.score,'assessed_at',n.assessed_at,'expires_at',n.expires_at) FROM need_assessments n
      WHERE n.tenant_id=t AND n.flo_id=f.id AND n.category_id=i.category_id AND n.status='CONFIRMED' ORDER BY n.assessed_at DESC,n.id LIMIT 1),
    'schedules',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM service_schedules s WHERE s.tenant_id=t AND s.flo_id=f.id),'[]'),
    'demands',coalesce((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('quantity',d.quantity::text)) FROM category_demands d
      WHERE d.tenant_id=t AND d.flo_id=f.id AND d.category_id=i.category_id),'[]'),
    'closures',coalesce((SELECT jsonb_agg(jsonb_build_object('starts_at',w.starts_at,'ends_at',w.ends_at)) FROM availability_windows w
      WHERE w.tenant_id=t AND w.flo_id=f.id AND w.kind IN('CLOSURE','UNAVAILABLE')),'[]'),
    'received',coalesce((SELECT sum(r.accepted_qty) FROM receipt_lines r WHERE r.tenant_id=t AND r.flo_id=f.id AND r.category_id=i.category_id
      AND r.unit=i.unit AND r.is_current AND r.received_at>=lo AND r.received_at<hi),0)::text,
    'received_7',coalesce((SELECT sum(r.accepted_qty) FROM receipt_lines r WHERE r.tenant_id=t AND r.flo_id=f.id AND r.category_id=i.category_id
      AND r.unit=i.unit AND r.is_current AND r.received_at>=tenant_now()-interval '7 days' AND r.received_at<=tenant_now()),0)::text,
    'received_30',coalesce((SELECT sum(r.accepted_qty) FROM receipt_lines r WHERE r.tenant_id=t AND r.flo_id=f.id AND r.category_id=i.category_id
      AND r.unit=i.unit AND r.is_current AND r.received_at>=tenant_now()-interval '30 days' AND r.received_at<=tenant_now()),0)::text,
    'last_received',(SELECT max(r.received_at) FROM receipt_lines r WHERE r.tenant_id=t AND r.flo_id=f.id AND r.category_id=i.category_id AND r.unit=i.unit AND r.is_current AND r.accepted_qty>0),
    'committed',coalesce((SELECT sum(a.quantity) FROM allocations a WHERE a.tenant_id=t AND a.flo_id=f.id AND a.category_id=i.category_id
      AND a.unit=i.unit AND a.planned_service_date BETWEEN day-29 AND service AND a.state IN
      ('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED','DISPATCHED','PARTIALLY_RECEIVED')),0)::text,
    'responses',(SELECT jsonb_build_object('opportunities',count(*),'timely',count(*) FILTER(WHERE r_timely)) FROM offers
      WHERE tenant_id=t AND flo_id=f.id AND r_eligible AND r_exclusion IS NULL AND sent_at>=lo AND sent_at<=tenant_now()),
    'reporting',coalesce((SELECT jsonb_agg(jsonb_build_object('type',b.type,'state',b.state,'due_at',b.due_at,'timeliness',b.resolved_timeliness))
      FROM evidence_obligations b WHERE b.tenant_id=t AND b.anchor_at>=lo AND b.anchor_at<=tenant_now() AND (
        (b.subject_type='DELIVERY' AND EXISTS(SELECT 1 FROM deliveries dd WHERE dd.tenant_id=t AND dd.id=b.subject_id AND dd.destination_flo_id=f.id)) OR
        (b.subject_type='DISTRIBUTION_EVENT' AND EXISTS(SELECT 1 FROM distribution_events de WHERE de.tenant_id=t AND de.id=b.subject_id AND de.flo_id=f.id)))),'[]')
  ) ORDER BY f.code COLLATE "C") INTO candidates FROM flos f WHERE f.tenant_id=t;
  RETURN jsonb_build_object('item_id',i.id,'item_revision',i.revision,'policy_id',pol.id,'policy',pol.body,'now',tenant_now(),
    'timezone',tz,'planning_date',day,'service_date',service,'horizon_start',lo,'horizon_end',hi,'from_date',day-29,'to_date_excl',service+1,
    'receipt_at',p_receipt,'distribution_at',p_distribution,'quantity',i.quantity::text,'unit',i.unit,
    'category',(SELECT code FROM categories WHERE tenant_id=t AND id=i.category_id),
    'increment',(SELECT min_increment::text FROM products WHERE tenant_id=t AND id=i.product_id),
    'available',greatest(0,i.quantity-coalesce((SELECT sum(a.quantity) FROM allocations a WHERE a.tenant_id=t AND a.item_id=i.id
      AND a.state NOT IN('PROPOSED','CANCELLED','EXPIRED','EXCEPTION')),0))::text,'candidates',coalesce(candidates,'[]'));
END $$;
GRANT EXECUTE ON FUNCTION lumbung.direct_features(uuid,timestamptz,timestamptz) TO lumbung_app;

CREATE FUNCTION lumbung.save_direct_run(p_item uuid,p_snapshot jsonb,p_result jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE t uuid:=require_ctx(); i donation_items; pol policy_versions; result jsonb; replay jsonb; rid uuid;
BEGIN
  PERFORM require_cap('allocation.run'); pol:=direct_policy('ALLOCATION');
  IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED','{"http":400}'); END IF;
  replay:=idem_begin(p_key,'allocation-run',p_hash); IF replay IS NOT NULL THEN RETURN replay; END IF;
  SELECT * INTO i FROM donation_items WHERE tenant_id=t AND id=p_item FOR UPDATE;
  IF i.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF i.revision<>(p_snapshot->>'item_revision')::int OR pol.id<>(p_snapshot->>'policy_id')::uuid THEN PERFORM lb_raise('APPROVAL_STALE'); END IF;
  INSERT INTO allocation_runs(tenant_id,item_id,item_revision,policy_version_id,planning_date,horizon_start,horizon_end,now_at,feature_snapshot,result,facts_hash,created_by)
    VALUES(t,i.id,i.revision,pol.id,(p_snapshot->>'planning_date')::date,(p_snapshot->>'horizon_start')::timestamptz,
      (p_snapshot->>'horizon_end')::timestamptz,(p_snapshot->>'now')::timestamptz,p_snapshot,p_result,canonical_hash(p_snapshot),current_user_id()) RETURNING id INTO rid;
  result:=jsonb_build_object('id',rid,'item_id',i.id,'result',p_result);
  PERFORM append_audit('ALLOCATION_RUN','ALLOCATION_RUN',rid,1,NULL,result,NULL,NULL,pol.id);
  PERFORM emit_event('ALLOCATION_RUN','ALLOCATION_RUN',rid,1,result);
  PERFORM idem_complete(p_key,result); RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.save_direct_run(uuid,jsonb,jsonb,text,text) TO lumbung_app;
