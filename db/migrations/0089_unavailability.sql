SET LOCAL search_path=lumbung,pg_temp;
CREATE FUNCTION lumbung.record_unavailability(p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); f flos; replay jsonb; result jsonb; wid uuid;
BEGIN
 PERFORM require_cap('flo.edit');IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 replay:=idem_begin(p_key,'flo-unavailability',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 SELECT * INTO f FROM flos WHERE tenant_id=t AND id=p_id FOR UPDATE;IF f.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 IF f.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
 IF (p->>'ends_at')::timestamptz<=(p->>'starts_at')::timestamptz OR length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
 INSERT INTO availability_windows(tenant_id,flo_id,kind,starts_at,ends_at,created_by) VALUES(t,f.id,'UNAVAILABLE',(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,current_user_id()) RETURNING id INTO wid;
 UPDATE flos SET revision=revision+1 WHERE tenant_id=t AND id=f.id;
 PERFORM append_audit('FLO_UNAVAILABLE','FLO',f.id,f.revision+1,p->>'reason',p);
 result:=jsonb_build_object('id',wid,'revision',f.revision+1,'state','RECORDED');PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.record_unavailability(uuid,jsonb,text,text) TO lumbung_app;
