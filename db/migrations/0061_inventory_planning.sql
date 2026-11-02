SET LOCAL search_path=lumbung,pg_temp;

CREATE FUNCTION lumbung.unit_factor(p_product uuid,p_from text,p_to text) RETURNS numeric
LANGUAGE sql STABLE SET search_path=lumbung,pg_temp AS $$
 SELECT CASE WHEN lower(p_from)=lower(p_to) THEN 1
   WHEN lower(p_from)='kg' AND lower(p_to)='g' OR lower(p_from)='l' AND lower(p_to)='ml' THEN 1000
   WHEN lower(p_from)='g' AND lower(p_to)='kg' OR lower(p_from)='ml' AND lower(p_to)='l' THEN 0.001
   ELSE (SELECT CASE WHEN lower(c.from_unit)=lower(p_from) THEN c.factor ELSE 1/c.factor END FROM unit_conversions c
     WHERE c.tenant_id=current_tenant() AND c.product_id=p_product AND c.provenance IN('MEASURED','APPROVED_ESTIMATE')
       AND (c.valid_from IS NULL OR c.valid_from<=tenant_now()) AND (c.valid_to IS NULL OR tenant_now()<c.valid_to)
       AND ((lower(c.from_unit)=lower(p_from) AND lower(c.to_unit)=lower(p_to)) OR (lower(c.to_unit)=lower(p_from) AND lower(c.from_unit)=lower(p_to)))
     ORDER BY c.version DESC,c.id LIMIT 1) END
$$;
CREATE FUNCTION lumbung.comparable_quantity(p_qty numeric,p_source uuid,p_unit text,p_target uuid,p_target_unit text) RETURNS numeric
LANGUAGE plpgsql STABLE SET search_path=lumbung,pg_temp AS $$
DECLARE quantity numeric;
BEGIN
 -- Callers already constrain the receipt/allocation category. Avoid repeated
 -- catalogue lookups for the overwhelmingly common identical canonical unit.
 IF lower(p_unit)=lower(p_target_unit) THEN RETURN p_qty;END IF;
 SELECT round(p_qty*unit_factor(p_source,p_unit,c.comparable_unit)/nullif(unit_factor(p_target,p_target_unit,c.comparable_unit),0),3) INTO quantity
 FROM products source JOIN categories c ON c.tenant_id=source.tenant_id AND c.id=source.category_id JOIN products target ON target.tenant_id=source.tenant_id AND target.id=p_target AND target.category_id=source.category_id
 WHERE source.tenant_id=current_tenant() AND source.id=p_source;
 RETURN quantity;
END $$;
CREATE FUNCTION lumbung.flo_remaining_capacity(p_product uuid,p_flo uuid,p_day date) RETURNS numeric
LANGUAGE plpgsql STABLE SET search_path=lumbung,pg_temp AS $$
DECLARE prod products; cap flo_category_capacities; factor numeric; committed numeric; received numeric; requested numeric;
BEGIN
 SELECT * INTO prod FROM products WHERE tenant_id=current_tenant() AND id=p_product;
 SELECT * INTO cap FROM flo_category_capacities WHERE tenant_id=current_tenant() AND flo_id=p_flo AND category_id=prod.category_id AND confirmed_by IS NOT NULL;
 factor:=unit_factor(prod.id,prod.base_unit,cap.unit);
 IF cap.id IS NULL OR cap.per_event_capacity IS NULL OR cap.distribution_capacity IS NULL OR factor IS NULL THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM allocations a LEFT JOIN donation_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id LEFT JOIN release_plans rp ON rp.tenant_id=a.tenant_id AND rp.id=a.release_plan_id
   WHERE a.tenant_id=current_tenant() AND a.flo_id=p_flo AND a.category_id=prod.category_id AND a.planned_service_date=p_day
   AND a.state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED','DISPATCHED','PARTIALLY_RECEIVED')
   AND comparable_quantity(a.quantity,coalesce(i.product_id,rp.product_id),a.unit,prod.id,prod.base_unit) IS NULL) THEN RETURN NULL;END IF;
 SELECT coalesce(sum(comparable_quantity(a.quantity,coalesce(i.product_id,rp.product_id),a.unit,prod.id,prod.base_unit)),0) INTO committed
   FROM allocations a LEFT JOIN donation_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id LEFT JOIN release_plans rp ON rp.tenant_id=a.tenant_id AND rp.id=a.release_plan_id
   WHERE a.tenant_id=current_tenant() AND a.flo_id=p_flo AND a.category_id=prod.category_id AND a.planned_service_date=p_day
   AND a.state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED','DISPATCHED','PARTIALLY_RECEIVED');
 SELECT coalesce(sum(comparable_quantity(rl.accepted_qty,dl.product_id,rl.unit,prod.id,prod.base_unit)),0) INTO received FROM receipt_lines rl JOIN delivery_lines dl ON dl.tenant_id=rl.tenant_id AND dl.id=rl.delivery_line_id
   JOIN tenants t ON t.id=rl.tenant_id WHERE rl.tenant_id=current_tenant() AND rl.flo_id=p_flo AND rl.category_id=prod.category_id AND rl.is_current AND (rl.received_at AT TIME ZONE t.timezone)::date=p_day;
 SELECT greatest(0,n.requested_qty-coalesce(n.available_stock_qty,0)-coalesce(n.expected_deliveries_qty,0))*unit_factor(prod.id,n.unit,prod.base_unit) INTO requested
   FROM need_assessments n WHERE n.tenant_id=current_tenant() AND n.flo_id=p_flo AND n.category_id=prod.category_id AND n.status='CONFIRMED' AND n.expires_at>tenant_now()
     AND n.intended_distribution_date=p_day ORDER BY n.assessed_at DESC,n.id LIMIT 1;
 RETURN greatest(0,least(cap.per_event_capacity/factor,cap.distribution_capacity/factor,coalesce(requested,cap.per_event_capacity/factor))-committed-received);
END $$;

CREATE FUNCTION lumbung.source_travel(p_source uuid,p_flo uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=lumbung,pg_temp AS $$
 WITH pair AS(SELECT s.code source_code,f.code flo_code,6371*2*asin(least(1,sqrt(power(sin(radians((f.lat-s.lat)::float8)/2),2)+cos(radians(s.lat::float8))*cos(radians(f.lat::float8))*power(sin(radians((f.lng-s.lng)::float8)/2),2)))) km
   FROM source_locations s JOIN flos f ON f.tenant_id=s.tenant_id AND f.id=p_flo WHERE s.tenant_id=current_tenant() AND s.id=p_source),
 fixtures AS(SELECT * FROM (VALUES('WH-JKU','FLO-0006',24),('WH-JKU','FLO-0009',22),('WH-JKU','FLO-0010',28),('SRC-001','FLO-0001',5),('SRC-001','FLO-0002',8),('SRC-001','FLO-0003',12),('SRC-001','FLO-0004',15),('SRC-001','FLO-0005',11)) v(src,flo,minutes))
 SELECT jsonb_build_object('distance_km',km,'minutes',coalesce(v.minutes,ceil(km/25*60)),'source',CASE WHEN v.minutes IS NULL THEN 'STRAIGHT_LINE_ESTIMATE' ELSE 'FIXTURE' END)
   FROM pair LEFT JOIN fixtures v ON v.src=source_code AND v.flo=flo_code
$$;

CREATE FUNCTION lumbung.batch_eligibility(p_release uuid,p_flo uuid,p_receipt timestamptz,p_distribution timestamptz) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path=lumbung,pg_temp AS $$
DECLARE rp release_plans; prod products; f flos; codes text[]:='{}'; tz text; travel jsonb; cat text; policy policy_versions;
BEGIN
 SELECT * INTO rp FROM release_plans WHERE tenant_id=current_tenant() AND id=p_release;
 SELECT * INTO f FROM flos WHERE tenant_id=current_tenant() AND id=p_flo;IF rp.id IS NULL OR f.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 SELECT * INTO prod FROM products WHERE tenant_id=current_tenant() AND id=rp.product_id;SELECT timezone INTO tz FROM tenants WHERE id=current_tenant();policy:=direct_policy('SAFETY');
 IF f.status<>'ACTIVE' THEN codes:=array_append(codes,'FLO_INACTIVE');END IF;
 IF agreement_valid_at(f.id,tenant_now()) IS NULL THEN codes:=array_append(codes,'AGREEMENT_UNVERIFIED');ELSIF agreement_valid_at(f.id,p_receipt) IS NULL THEN codes:=array_append(codes,'AGREEMENT_EXPIRES_IN_TRANSIT');END IF;
 IF prod.allergens&&f.allergen_exclusions OR (f.halal_required AND prod.halal_status<>'HALAL') OR EXISTS(SELECT 1 FROM flo_category_prefs WHERE tenant_id=current_tenant() AND flo_id=f.id AND category_id=prod.category_id AND preference='EXCLUDE') THEN codes:=array_append(codes,'DIET_CONFLICT');END IF;
 IF NOT prod.storage_profile=ANY(f.storage_capabilities) THEN codes:=array_append(codes,'STORAGE_INCOMPATIBLE');END IF;
 IF NOT EXISTS(SELECT 1 FROM flo_contacts WHERE tenant_id=current_tenant() AND flo_id=f.id AND channel='SIM' AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL) THEN codes:=array_append(codes,'CONTACT_UNAUTHORISED');END IF;
 IF NOT direct_window_open(f.id,'RECEIVING',p_receipt) THEN codes:=array_append(codes,'RECEIVING_CLOSED');END IF;
 IF f.location_confidence NOT IN('HIGH','MEDIUM') OR f.lat IS NULL THEN codes:=array_append(codes,'LOCATION_UNVERIFIED');END IF;
 IF flo_remaining_capacity(prod.id,f.id,(p_distribution AT TIME ZONE tz)::date) IS NULL THEN codes:=array_append(codes,'CAPACITY_UNKNOWN');END IF;
 IF p_receipt<greatest(tenant_now(),rp.pickup_start) OR p_distribution<p_receipt OR tenant_now()>=rp.pickup_end THEN codes:=array_append(codes,'FOOD_WINDOW_EXCEEDED');END IF;
 travel:=source_travel(rp.warehouse_id,f.id);SELECT code INTO cat FROM categories WHERE tenant_id=current_tenant() AND id=prod.category_id;policy:=direct_policy('ALLOCATION');
 IF (travel->>'distance_km')::numeric>20 OR (travel->>'minutes')::numeric>(policy.body->'hard_max_travel_minutes'->>cat)::numeric
   OR greatest(tenant_now(),rp.pickup_start)+make_interval(mins=>(travel->>'minutes')::int)>p_receipt THEN codes:=array_append(codes,'FOOD_WINDOW_EXCEEDED');END IF;
 IF NOT EXISTS(SELECT 1 FROM inventory_batches b JOIN storage_locations s ON s.tenant_id=b.tenant_id AND s.id=b.storage_location_id JOIN batch_balances bb ON bb.tenant_id=b.tenant_id AND bb.batch_id=b.id AND bb.account IN('AVAILABLE','RESERVED') AND bb.qty>0
   WHERE b.tenant_id=current_tenant() AND b.product_id=prod.id AND s.warehouse_id=rp.warehouse_id AND batch_is_usable(b.id,p_distribution)) THEN codes:=array_append(codes,'STOCK_UNAVAILABLE');END IF;
 RETURN codes;
END $$;

CREATE FUNCTION lumbung.inventory_features(p_item uuid,p_receipt timestamptz,p_distribution timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE t uuid:=require_ctx(); i donation_items; rp release_plans; prod products; pol policy_versions; tz text; day date; service date; lo timestamptz; hi timestamptz; candidates jsonb;
BEGIN
  PERFORM require_cap('allocation.run');
  SELECT * INTO rp FROM release_plans WHERE tenant_id=t AND id=p_item;
  SELECT * INTO prod FROM products WHERE tenant_id=t AND id=rp.product_id;
  i:=jsonb_populate_record(NULL::donation_items,jsonb_build_object('id',rp.id,'product_id',prod.id,'category_id',prod.category_id,'unit',prod.base_unit,'quantity',rp.quantity,'revision',rp.revision,'safety_state','CLEARED','distribute_by',rp.distribution_at));
  IF i.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  pol:=direct_policy('ALLOCATION');
  IF i.safety_state<>'CLEARED' THEN PERFORM lb_raise('SAFETY_REVIEW_REQUIRED'); END IF;
  SELECT timezone INTO tz FROM tenants WHERE id=t;
  day:=(tenant_now() AT TIME ZONE tz)::date; service:=(p_distribution AT TIME ZONE tz)::date;
  IF service<day OR service>day+30 OR p_receipt<tenant_now() OR p_distribution<p_receipt OR p_distribution>i.distribute_by THEN
    PERFORM lb_raise('FOOD_WINDOW_EXCEEDED'); END IF;
  lo:=(day-29)::timestamp AT TIME ZONE tz; hi:=(service+1)::timestamp AT TIME ZONE tz;
  SELECT jsonb_agg(jsonb_build_object('id',f.id,'code',f.code,'name',f.name,
    'reasons',batch_eligibility(rp.id,f.id,p_receipt,p_distribution),'travel',source_travel(rp.warehouse_id,f.id),
    'same_cluster',EXISTS(SELECT 1 FROM flo_clusters fc JOIN source_locations s ON s.tenant_id=fc.tenant_id AND s.id=rp.warehouse_id
      WHERE fc.tenant_id=t AND fc.flo_id=f.id AND fc.cluster_id=s.cluster_id),
    'capacity',flo_remaining_capacity(prod.id,f.id,service)::text,
    'need',(SELECT jsonb_build_object('score',n.score,'assessed_at',n.assessed_at,'expires_at',n.expires_at) FROM need_assessments n
      WHERE n.tenant_id=t AND n.flo_id=f.id AND n.category_id=i.category_id AND n.status='CONFIRMED' ORDER BY n.assessed_at DESC,n.id LIMIT 1),
    'schedules',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM service_schedules s WHERE s.tenant_id=t AND s.flo_id=f.id),'[]'),
    'demands',coalesce((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('quantity',round(d.quantity*unit_factor(prod.id,d.unit,prod.base_unit),3)::text,'unit',prod.base_unit)) FROM category_demands d
      WHERE d.tenant_id=t AND d.flo_id=f.id AND d.category_id=i.category_id AND unit_factor(prod.id,d.unit,prod.base_unit) IS NOT NULL),'[]'),
    'closures',coalesce((SELECT jsonb_agg(jsonb_build_object('starts_at',w.starts_at,'ends_at',w.ends_at)) FROM availability_windows w
      WHERE w.tenant_id=t AND w.flo_id=f.id AND w.kind IN('CLOSURE','UNAVAILABLE')),'[]'),
    'received',coalesce((SELECT sum(comparable_quantity(r.accepted_qty,(SELECT product_id FROM delivery_lines WHERE tenant_id=t AND id=r.delivery_line_id),r.unit,prod.id,prod.base_unit)) FROM receipt_lines r WHERE r.tenant_id=t AND r.flo_id=f.id AND r.category_id=i.category_id
      AND comparable_quantity(1,(SELECT product_id FROM delivery_lines WHERE tenant_id=t AND id=r.delivery_line_id),r.unit,prod.id,prod.base_unit) IS NOT NULL AND r.is_current AND r.received_at>=lo AND r.received_at<hi),0)::text,
    'received_7',coalesce((SELECT sum(comparable_quantity(r.accepted_qty,(SELECT product_id FROM delivery_lines WHERE tenant_id=t AND id=r.delivery_line_id),r.unit,prod.id,prod.base_unit)) FROM receipt_lines r WHERE r.tenant_id=t AND r.flo_id=f.id AND r.category_id=i.category_id
      AND comparable_quantity(1,(SELECT product_id FROM delivery_lines WHERE tenant_id=t AND id=r.delivery_line_id),r.unit,prod.id,prod.base_unit) IS NOT NULL AND r.is_current AND r.received_at>=tenant_now()-interval '7 days' AND r.received_at<=tenant_now()),0)::text,
    'received_30',coalesce((SELECT sum(comparable_quantity(r.accepted_qty,(SELECT product_id FROM delivery_lines WHERE tenant_id=t AND id=r.delivery_line_id),r.unit,prod.id,prod.base_unit)) FROM receipt_lines r WHERE r.tenant_id=t AND r.flo_id=f.id AND r.category_id=i.category_id
      AND comparable_quantity(1,(SELECT product_id FROM delivery_lines WHERE tenant_id=t AND id=r.delivery_line_id),r.unit,prod.id,prod.base_unit) IS NOT NULL AND r.is_current AND r.received_at>=tenant_now()-interval '30 days' AND r.received_at<=tenant_now()),0)::text,
    'last_received',(SELECT max(r.received_at) FROM receipt_lines r WHERE r.tenant_id=t AND r.flo_id=f.id AND r.category_id=i.category_id AND comparable_quantity(1,(SELECT product_id FROM delivery_lines WHERE tenant_id=t AND id=r.delivery_line_id),r.unit,prod.id,prod.base_unit) IS NOT NULL AND r.is_current AND r.accepted_qty>0),
    'committed',coalesce((SELECT sum(comparable_quantity(a.quantity,coalesce(ai.product_id,ar.product_id),a.unit,prod.id,prod.base_unit)) FROM allocations a
      LEFT JOIN donation_items ai ON ai.tenant_id=a.tenant_id AND ai.id=a.item_id LEFT JOIN release_plans ar ON ar.tenant_id=a.tenant_id AND ar.id=a.release_plan_id
      WHERE a.tenant_id=t AND a.flo_id=f.id AND a.category_id=i.category_id AND a.planned_service_date BETWEEN day-29 AND service AND a.state IN
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
    'available',least(rp.quantity,coalesce((SELECT sum(bb.qty) FROM inventory_batches b JOIN storage_locations sl ON sl.tenant_id=b.tenant_id AND sl.id=b.storage_location_id JOIN batch_balances bb ON bb.tenant_id=b.tenant_id AND bb.batch_id=b.id AND bb.account='AVAILABLE' WHERE b.tenant_id=t AND b.product_id=prod.id AND sl.warehouse_id=rp.warehouse_id AND batch_is_usable(b.id,p_distribution)),0))::text,'candidates',coalesce(candidates,'[]'));
END $$;
GRANT EXECUTE ON FUNCTION lumbung.inventory_features(uuid,timestamptz,timestamptz) TO lumbung_app;

