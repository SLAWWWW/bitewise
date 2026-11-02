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
      condition,storage_req,prep_info,label_info,distribute_by,conversion_id,parse,est_weight_kg,measured_weight_kg,weight_provenance,created_by)
      VALUES(current_tenant(),o.id,n,prod.id,prod.category_id,prod.name,qty,prod.base_unit,prod.unit_kind,
        line->>'condition',prod.storage_profile,coalesce(line->'prep_info','{}'),coalesce(line->'label_info','{}'),
        (line->>'distribute_by')::timestamptz,conversion,jsonb_build_object('raw_quantity',line->>'quantity','raw_unit',line->>'unit','conversion_factor',factor,'conversion_id',conversion),(line->>'est_weight_kg')::numeric,(line->>'measured_weight_kg')::numeric,line->>'weight_provenance',current_user_id());
  END LOOP;
  RETURN jsonb_build_object('id',o.id,'revision',o.revision,'state',o.operational_state);
END $$;


