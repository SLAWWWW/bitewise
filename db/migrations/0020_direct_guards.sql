-- Stage 2. Internal deterministic guards; only command entry points are granted.
SET LOCAL search_path = lumbung, pg_temp;

CREATE FUNCTION lumbung.direct_policy(p_kind text) RETURNS lumbung.policy_versions
LANGUAGE plpgsql STABLE SET search_path = lumbung, pg_temp AS $$
DECLARE p lumbung.policy_versions; m text;
BEGIN
  SELECT mode INTO m FROM tenants WHERE id=current_tenant();
  SELECT v.* INTO p FROM policy_versions v JOIN tenant_active_policies a
    ON a.tenant_id=v.tenant_id AND a.policy_version_id=v.id
    WHERE a.tenant_id=current_tenant() AND a.kind=p_kind;
  IF p.id IS NULL OR (m='LIVE' AND p.status<>'APPROVED_LIVE')
    OR (m<>'LIVE' AND p.status NOT IN ('APPROVED_DEMO','APPROVED_LIVE')) THEN
    PERFORM lb_raise('SAFETY_POLICY_UNAPPROVED',jsonb_build_object('kind',p_kind));
  END IF;
  -- This slice implements the synthetic policy only. An approved live profile
  -- needs its own validated evaluator before any live allocation is enabled.
  IF m='LIVE' THEN PERFORM lb_raise('LIVE_FORBIDDEN'); END IF;
  RETURN p;
END $$;

CREATE FUNCTION lumbung.direct_travel(p_item uuid,p_flo uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = lumbung, pg_temp AS $$
  WITH pair AS (
    SELECT s.code source_code,f.code flo_code,
      6371 * 2 * asin(least(1,sqrt(power(sin(radians((f.lat-s.lat)::float8)/2),2)
      +cos(radians(s.lat::float8))*cos(radians(f.lat::float8))*power(sin(radians((f.lng-s.lng)::float8)/2),2)))) km
    FROM donation_items i JOIN donation_orders o ON o.tenant_id=i.tenant_id AND o.id=i.order_id
    JOIN source_locations s ON s.tenant_id=o.tenant_id AND s.id=o.source_location_id
    JOIN flos f ON f.tenant_id=i.tenant_id AND f.id=p_flo
    WHERE i.tenant_id=current_tenant() AND i.id=p_item
  ), fixture AS (
    SELECT * FROM (VALUES ('SRC-001','FLO-0001',5),('SRC-001','FLO-0002',8),
      ('SRC-001','FLO-0003',12),('SRC-001','FLO-0004',15),('SRC-001','FLO-0005',11)) v(src,flo,minutes)
  ) SELECT jsonb_build_object('distance_km',km,'minutes',coalesce(v.minutes,ceil(km/25*60)),
      'source',CASE WHEN v.minutes IS NULL THEN 'STRAIGHT_LINE_ESTIMATE' ELSE 'FIXTURE' END)
    FROM pair LEFT JOIN fixture v ON v.src=source_code AND v.flo=flo_code
$$;

CREATE FUNCTION lumbung.direct_window_open(p_flo uuid,p_kind text,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = lumbung, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM availability_windows w JOIN tenants t ON t.id=w.tenant_id
    WHERE w.tenant_id=current_tenant() AND w.flo_id=p_flo AND w.kind=p_kind
      AND w.dow=extract(isodow FROM p_at AT TIME ZONE t.timezone)
      AND (p_at AT TIME ZONE t.timezone)::time >= w.start_local
      AND (p_at AT TIME ZONE t.timezone)::time < w.end_local
  ) AND NOT EXISTS (
    SELECT 1 FROM availability_windows w WHERE w.tenant_id=current_tenant() AND w.flo_id=p_flo
      AND w.kind IN ('CLOSURE','UNAVAILABLE') AND w.starts_at<=p_at AND p_at<w.ends_at
  )
$$;

CREATE FUNCTION lumbung.direct_remaining_capacity(p_item uuid,p_flo uuid,p_service date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = lumbung, pg_temp AS $$
  SELECT greatest(0,least(c.per_event_capacity,c.distribution_capacity,
      coalesce((SELECT greatest(0,n.requested_qty-coalesce(n.available_stock_qty,0)-coalesce(n.expected_deliveries_qty,0))
        FROM need_assessments n WHERE n.tenant_id=i.tenant_id AND n.flo_id=p_flo
          AND n.category_id=i.category_id AND n.unit=i.unit AND n.status='CONFIRMED'
          AND n.expires_at>tenant_now() AND n.intended_distribution_date=p_service
        ORDER BY n.assessed_at DESC,n.id LIMIT 1),c.per_event_capacity))
    -coalesce((SELECT sum(a.quantity) FROM allocations a WHERE a.tenant_id=i.tenant_id
      AND a.flo_id=p_flo AND a.category_id=i.category_id AND a.unit=i.unit
      AND a.planned_service_date=p_service AND a.state IN
      ('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED','DISPATCHED','PARTIALLY_RECEIVED')),0)
    -coalesce((SELECT sum(r.accepted_qty) FROM receipt_lines r JOIN tenants t ON t.id=r.tenant_id
      WHERE r.tenant_id=i.tenant_id AND r.flo_id=p_flo AND r.category_id=i.category_id AND r.unit=i.unit
      AND r.is_current AND (r.received_at AT TIME ZONE t.timezone)::date=p_service),0))
  FROM donation_items i JOIN flo_category_capacities c ON c.tenant_id=i.tenant_id
    AND c.category_id=i.category_id AND c.flo_id=p_flo AND c.unit=i.unit
    AND c.confirmed_by IS NOT NULL AND c.per_event_capacity IS NOT NULL AND c.distribution_capacity IS NOT NULL
  WHERE i.tenant_id=current_tenant() AND i.id=p_item
$$;

CREATE FUNCTION lumbung.direct_eligibility(p_item uuid,p_flo uuid,p_receipt timestamptz,p_distribution timestamptz)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = lumbung, pg_temp AS $$
DECLARE i donation_items; f flos; p products; o donation_orders; pol policy_versions;
  codes text[]:='{}'; tz text; travel jsonb; cat text;
BEGIN
  SELECT * INTO i FROM donation_items WHERE tenant_id=current_tenant() AND id=p_item;
  SELECT * INTO f FROM flos WHERE tenant_id=current_tenant() AND id=p_flo;
  IF i.id IS NULL OR f.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  SELECT * INTO o FROM donation_orders WHERE tenant_id=current_tenant() AND id=i.order_id;
  SELECT * INTO p FROM products WHERE tenant_id=current_tenant() AND id=i.product_id;
  SELECT timezone INTO tz FROM tenants WHERE id=current_tenant();
  pol:=direct_policy('SAFETY');
  IF f.status<>'ACTIVE' THEN codes:=array_append(codes,'FLO_INACTIVE'); END IF;
  IF agreement_valid_at(p_flo,tenant_now()) IS NULL THEN
    codes:=array_append(codes,CASE
      WHEN EXISTS(SELECT 1 FROM agreements WHERE tenant_id=current_tenant() AND flo_id=p_flo AND review_state='REVOKED') THEN 'AGREEMENT_REVOKED'
      WHEN EXISTS(SELECT 1 FROM agreements WHERE tenant_id=current_tenant() AND flo_id=p_flo AND review_state='APPROVED' AND effective_until<=tenant_now()) THEN 'AGREEMENT_EXPIRED'
      ELSE 'AGREEMENT_UNVERIFIED' END);
  ELSIF agreement_valid_at(p_flo,p_receipt) IS NULL THEN codes:=array_append(codes,'AGREEMENT_EXPIRES_IN_TRANSIT'); END IF;
  IF i.safety_state<>'CLEARED' OR NOT EXISTS(SELECT 1 FROM safety_evaluations e
      WHERE e.tenant_id=current_tenant() AND e.subject_id=i.id AND e.policy_version_id=pol.id AND e.verdict='CLEARED') THEN
    codes:=array_append(codes,'SAFETY_REVIEW_REQUIRED'); END IF;
  IF p_receipt IS NULL OR p_distribution IS NULL OR p_receipt<tenant_now() OR p_distribution<p_receipt
      OR p_distribution>i.distribute_by OR p_receipt>=i.distribute_by OR tenant_now()>=o.pickup_end THEN
    codes:=array_append(codes,'FOOD_WINDOW_EXCEEDED'); END IF;
  IF f.allergen_exclusions && p.allergens OR (f.halal_required AND p.halal_status IS DISTINCT FROM 'HALAL')
      OR EXISTS(SELECT 1 FROM flo_category_prefs WHERE tenant_id=current_tenant() AND flo_id=p_flo
        AND category_id=i.category_id AND preference='EXCLUDE') THEN codes:=array_append(codes,'DIET_CONFLICT'); END IF;
  IF NOT i.storage_req=ANY(f.storage_capabilities) THEN codes:=array_append(codes,'STORAGE_INCOMPATIBLE'); END IF;
  IF NOT EXISTS(SELECT 1 FROM flo_contacts WHERE tenant_id=current_tenant() AND flo_id=p_flo
      AND channel='SIM' AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL) THEN
    codes:=array_append(codes,'CONTACT_UNAUTHORISED'); END IF;
  IF NOT direct_window_open(p_flo,'RECEIVING',p_receipt) THEN codes:=array_append(codes,'RECEIVING_CLOSED'); END IF;
  IF f.location_confidence NOT IN ('HIGH','MEDIUM') OR f.lat IS NULL OR NOT EXISTS(
      SELECT 1 FROM source_locations WHERE tenant_id=current_tenant() AND id=o.source_location_id
        AND lat IS NOT NULL AND location_confidence IN ('HIGH','MEDIUM')) THEN codes:=array_append(codes,'LOCATION_UNVERIFIED'); END IF;
  IF direct_remaining_capacity(p_item,p_flo,(p_distribution AT TIME ZONE tz)::date) IS NULL THEN
    codes:=array_append(codes,'CAPACITY_UNKNOWN'); END IF;
  travel:=direct_travel(p_item,p_flo);
  SELECT code INTO cat FROM categories WHERE tenant_id=current_tenant() AND id=i.category_id;
  pol:=direct_policy('ALLOCATION');
  IF (travel->>'distance_km')::numeric>20 OR (travel->>'minutes')::numeric>(pol.body->'hard_max_travel_minutes'->>cat)::numeric
    OR greatest(tenant_now(),o.pickup_start)+make_interval(mins=>(travel->>'minutes')::int)>p_receipt THEN
    codes:=array_append(codes,'FOOD_WINDOW_EXCEEDED'); END IF;
  IF cat='PREPARED_MEAL' AND travel->>'source'<>'FIXTURE' THEN codes:=array_append(codes,'ROUTE_CONFIRMATION_REQUIRED'); END IF;
  RETURN codes;
END $$;

-- Material changes invalidate approvals even when made through a later command.
CREATE FUNCTION lumbung.tg_direct_approval_invalidation() RETURNS trigger
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['state','revision','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','revision','updated_at']) THEN
    NEW.revision:=OLD.revision+1;
    UPDATE approvals SET invalidated_at=tenant_now_at(NEW.tenant_id),invalidated_reason='MATERIAL_CHANGE'
      WHERE tenant_id=NEW.tenant_id AND subject_id=NEW.id AND invalidated_at IS NULL;
    IF NEW.state='APPROVED' THEN NEW.state:='LOGISTICS_PENDING'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER direct_allocation_invalidation BEFORE UPDATE ON allocations
  FOR EACH ROW EXECUTE FUNCTION tg_direct_approval_invalidation();

CREATE FUNCTION lumbung.refresh_direct_order(p_item uuid) RETURNS void
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE oid uuid; next_state text; all_assigned boolean; all_received boolean; any_assigned boolean; any_held boolean;
BEGIN
  SELECT order_id INTO oid FROM donation_items WHERE tenant_id=current_tenant() AND id=p_item;
  SELECT bool_and(committed>=quantity),bool_and(received>=quantity),bool_or(committed>0),bool_or(held>0)
    INTO all_assigned,all_received,any_assigned,any_held
    FROM (SELECT i.quantity,
      coalesce((SELECT sum(a.quantity) FROM allocations a WHERE a.tenant_id=i.tenant_id AND a.item_id=i.id
        AND a.state IN('ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED','DISPATCHED','RECEIVED','PARTIALLY_RECEIVED')),0) committed,
      coalesce((SELECT sum(a.quantity) FROM allocations a WHERE a.tenant_id=i.tenant_id AND a.item_id=i.id AND a.state='RECEIVED'),0) received,
      coalesce((SELECT sum(a.quantity) FROM allocations a WHERE a.tenant_id=i.tenant_id AND a.item_id=i.id AND a.state='OFFER_HELD'),0) held
      FROM donation_items i WHERE i.tenant_id=current_tenant() AND i.order_id=oid) facts;
  next_state:=CASE
    WHEN all_received AND NOT EXISTS(SELECT 1 FROM tasks tk JOIN delivery_lines dl ON dl.delivery_id=tk.subject_id AND dl.tenant_id=tk.tenant_id
      JOIN donation_items i ON i.id=dl.item_id AND i.tenant_id=dl.tenant_id WHERE tk.tenant_id=current_tenant() AND i.order_id=oid
        AND tk.kind='RECEIPT_DISCREPANCY' AND tk.state IN('OPEN','CLAIMED')) THEN 'CLOSED'
    WHEN all_assigned THEN 'FULLY_ALLOCATED' WHEN any_assigned THEN 'PARTIALLY_ALLOCATED' WHEN any_held THEN 'ALLOCATING' ELSE 'READY' END;
  UPDATE donation_orders SET operational_state=next_state,revision=revision+1,updated_at=tenant_now(),
    reporting_state=CASE WHEN next_state='CLOSED' THEN coalesce(reporting_state,'OPEN') ELSE reporting_state END
    WHERE tenant_id=current_tenant() AND id=oid AND operational_state NOT IN('DRAFT','NEEDS_INFO','SAFETY_REVIEW','CANCELLED')
      AND operational_state IS DISTINCT FROM next_state;
END $$;

CREATE FUNCTION lumbung.direct_release(p_allocation uuid,p_reason text,p_state text DEFAULT 'CANCELLED') RETURNS void
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
BEGIN
  UPDATE reservation_lines SET state='RELEASED' WHERE tenant_id=current_tenant() AND state='ACTIVE'
    AND reservation_id IN(SELECT id FROM reservations WHERE tenant_id=current_tenant() AND allocation_id=p_allocation AND state='ACTIVE');
  UPDATE reservations SET state='RELEASED',released_reason=p_reason,revision=revision+1
    WHERE tenant_id=current_tenant() AND allocation_id=p_allocation AND state='ACTIVE';
  UPDATE allocations SET state=p_state,cancel_reason=p_reason,revision=revision+1
    WHERE tenant_id=current_tenant() AND id=p_allocation AND state NOT IN('DISPATCHED','RECEIVED','PARTIALLY_RECEIVED');
  UPDATE approvals SET invalidated_at=tenant_now(),invalidated_reason=p_reason
    WHERE tenant_id=current_tenant() AND subject_id=p_allocation AND invalidated_at IS NULL;
  UPDATE offers SET state=CASE WHEN p_state='EXPIRED' THEN 'EXPIRED' ELSE 'CANCELLED' END,revision=revision+1,
    r_eligible=p_state='EXPIRED' AND delivery_receipt_at IS NOT NULL,
    r_timely=CASE WHEN p_state='EXPIRED' AND delivery_receipt_at IS NOT NULL THEN false ELSE r_timely END,
    r_exclusion=CASE WHEN p_state<>'EXPIRED' THEN 'STAFF_CANCELLED' WHEN delivery_receipt_at IS NULL THEN 'NO_DELIVERY_RECEIPT' ELSE NULL END
    WHERE tenant_id=current_tenant() AND allocation_id=p_allocation AND state IN('HELD','QUEUED','SENT','DELIVERED');
  UPDATE outbox SET state='CANCELLED' WHERE tenant_id=current_tenant() AND state IN('PENDING','HELD_TAKEOVER')
    AND id IN(SELECT outbox_id FROM offers WHERE tenant_id=current_tenant() AND allocation_id=p_allocation);
  PERFORM emit_event('RESERVATION_RELEASED','ALLOCATION',p_allocation,NULL,jsonb_build_object('reason',p_reason));
  PERFORM refresh_direct_order((SELECT item_id FROM allocations WHERE tenant_id=current_tenant() AND id=p_allocation));
END $$;

CREATE OR REPLACE FUNCTION lumbung.on_agreement_revoked(p_agreement uuid,p_flo uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
DECLARE a record; n int:=0;
BEGIN
  FOR a IN SELECT id FROM allocations WHERE tenant_id=current_tenant() AND flo_id=p_flo
      AND source_type='DIRECT_ITEM' AND state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED') ORDER BY id LOOP
    PERFORM direct_release(a.id,'AGREEMENT_REVOKED','EXCEPTION');
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload)
      VALUES(current_tenant(),'AGREEMENT_REVOKED_ACTIVE_COMMITMENT','ALLOCATION',a.id,'HIGH','OPEN',
        'revoked:'||a.id||':'||p_agreement,jsonb_build_object('agreement_id',p_agreement,'reason',p_reason)) ON CONFLICT DO NOTHING;
    n:=n+1;
  END LOOP;
  RETURN jsonb_build_object('affected_allocations',n);
END $$;
