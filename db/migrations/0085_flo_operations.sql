SET LOCAL search_path=lumbung,pg_temp;
CREATE FUNCTION lumbung.configure_flo(p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); f flos; replay jsonb; result jsonb; start_date date:=(tenant_now() AT TIME ZONE 'Asia/Jakarta')::date; dow int;
BEGIN
 PERFORM require_cap('flo.edit');PERFORM require_cap('need.confirm');
 IF current_actor_kind()<>'USER' OR length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 replay:=idem_begin(p_key,'configure-flo',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM 1 FROM flo_category_capacities WHERE tenant_id=t AND flo_id=p_id ORDER BY category_id FOR UPDATE;
 SELECT * INTO f FROM flos WHERE tenant_id=t AND id=p_id FOR UPDATE;IF f.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 IF f.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
 IF NOT EXISTS(SELECT 1 FROM categories WHERE tenant_id=t AND id=(p->>'category_id')::uuid AND comparable_unit=p->>'unit') THEN PERFORM lb_raise('UNIT_MISMATCH');END IF;
 IF (p->>'capacity')::numeric<0 OR (p->>'demand')::numeric<=0 OR (p->>'people')::int<=0 OR (p->>'start_local')::time>=(p->>'end_local')::time THEN PERFORM lb_raise('BAD_REQUEST');END IF;
 INSERT INTO flo_category_capacities(tenant_id,flo_id,category_id,unit,per_event_capacity,distribution_capacity,confirmed_at,confirmed_by)
 VALUES(t,f.id,(p->>'category_id')::uuid,p->>'unit',(p->>'capacity')::numeric,(p->>'capacity')::numeric,tenant_now(),current_user_id())
 ON CONFLICT(tenant_id,flo_id,category_id) DO UPDATE SET unit=excluded.unit,per_event_capacity=excluded.per_event_capacity,distribution_capacity=excluded.distribution_capacity,confirmed_at=excluded.confirmed_at,confirmed_by=excluded.confirmed_by;
 -- Keep earlier effective versions. Same-day edits replace that day's settings;
 -- their previous values remain in the audit trail.
 DELETE FROM service_schedules WHERE tenant_id=t AND flo_id=f.id AND effective_from>=start_date;
 UPDATE service_schedules SET effective_to_excl=start_date WHERE tenant_id=t AND flo_id=f.id AND effective_from<start_date AND (effective_to_excl IS NULL OR effective_to_excl>start_date);
 INSERT INTO service_schedules(tenant_id,flo_id,effective_from,service_dows,people_per_event,count_basis,declared_count,verified_count,verified_by,verified_at)
 VALUES(t,f.id,start_date,ARRAY(SELECT jsonb_array_elements_text(p->'service_dows')::int),(p->>'people')::int,p->>'count_basis',(p->>'people')::int,(p->>'people')::int,current_user_id(),tenant_now());
 DELETE FROM category_demands WHERE tenant_id=t AND flo_id=f.id AND category_id=(p->>'category_id')::uuid AND valid_from>=start_date;
 UPDATE category_demands SET valid_to_excl=start_date WHERE tenant_id=t AND flo_id=f.id AND category_id=(p->>'category_id')::uuid AND valid_from<start_date AND (valid_to_excl IS NULL OR valid_to_excl>start_date);
 INSERT INTO category_demands(tenant_id,flo_id,category_id,unit,basis,quantity,valid_from,confidence,assessor_id,confirmed_by,status)
 VALUES(t,f.id,(p->>'category_id')::uuid,p->>'unit',p->>'basis',(p->>'demand')::numeric,start_date,'HIGH',current_user_id(),current_user_id(),'CONFIRMED');
 DELETE FROM availability_windows WHERE tenant_id=t AND flo_id=f.id AND kind IN('RECEIVING','CONTACT');
 FOR dow IN 1..7 LOOP
  INSERT INTO availability_windows(tenant_id,flo_id,kind,dow,start_local,end_local) VALUES(t,f.id,'RECEIVING',dow,(p->>'start_local')::time,(p->>'end_local')::time),(t,f.id,'CONTACT',dow,(p->>'start_local')::time,(p->>'end_local')::time);
 END LOOP;
 IF p->>'contact_id' IS NOT NULL THEN
  UPDATE flo_contacts SET consent_state=p->>'consent_state',opted_out_at=CASE WHEN p->>'consent_state'='WITHDRAWN' THEN tenant_now() END
   WHERE tenant_id=t AND flo_id=f.id AND id=(p->>'contact_id')::uuid;
  IF NOT FOUND THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 END IF;
 UPDATE flos SET revision=revision+1 WHERE tenant_id=t AND id=f.id;
 PERFORM append_audit('FLO_OPERATIONS_CONFIGURED','FLO',f.id,f.revision+1,p->>'reason',p);
 result:=jsonb_build_object('id',f.id,'revision',f.revision+1,'state','CONFIGURED');PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.configure_flo(uuid,jsonb,text,text) TO lumbung_app;
