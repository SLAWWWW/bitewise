SET LOCAL search_path=lumbung,pg_temp;

CREATE FUNCTION lumbung.create_flo_link(p_type text,p_subject uuid,p_token_hash text,p_hours int,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); flo uuid; contact uuid; result jsonb; replay jsonb; lid uuid;
BEGIN
  PERFORM require_cap('message.send');
  IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  IF p_type='DELIVERY' THEN SELECT destination_flo_id INTO flo FROM deliveries WHERE tenant_id=t AND id=p_subject;
  ELSIF p_type='ALLOCATION' THEN SELECT flo_id INTO flo FROM allocations WHERE tenant_id=t AND id=p_subject;
  ELSE PERFORM lb_raise('BAD_REQUEST'); END IF;
  IF flo IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF p_hours NOT BETWEEN 1 AND 168 OR p_token_hash !~ '^[0-9a-f]{64}$' THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
  replay:=idem_begin(p_key,'create-flo-link',p_hash); IF replay IS NOT NULL THEN RETURN replay; END IF;
  SELECT id INTO contact FROM flo_contacts WHERE tenant_id=t AND flo_id=flo AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL ORDER BY id LIMIT 1;
  IF contact IS NULL THEN PERFORM lb_raise('CONTACT_UNAUTHORISED'); END IF;
  INSERT INTO flo_access_links(tenant_id,flo_id,contact_id,subject_type,subject_id,actions,token_hash,expires_at)
    VALUES(t,flo,contact,p_type,p_subject,ARRAY['offer.respond','transport.edit','delivery.receive','evidence.submit'],p_token_hash,tenant_now()+make_interval(hours=>p_hours)) RETURNING id INTO lid;
  result:=jsonb_build_object('id',lid,'expires_at',tenant_now()+make_interval(hours=>p_hours));
  PERFORM append_audit('FLO_LINK_CREATED',p_type,p_subject,NULL,NULL,result); PERFORM idem_complete(p_key,result); RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.create_flo_link(text,uuid,text,int,text,text) TO lumbung_app;

-- Bootstrap only from a 256-bit bearer secret. No tenant UUID or capability is
-- accepted from the caller. The derived context is local to this transaction.
CREATE FUNCTION lumbung.resolve_flo_link(p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE l flo_access_links; result jsonb;
BEGIN
  SELECT * INTO l FROM flo_access_links WHERE token_hash=p_hash AND revoked_at IS NULL;
  IF l.id IS NULL OR l.expires_at<=tenant_now_at(l.tenant_id) THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  PERFORM set_config('app.tenant_id',l.tenant_id::text,true),set_config('app.actor_kind','FLO_LINK',true),set_config('app.user_id','',true),set_config('app.link_id',l.id::text,true);
  PERFORM require_ctx(); PERFORM require_cap('evidence.submit');
  SELECT jsonb_build_object('tenant_id',l.tenant_id,'id',l.id,'flo_id',l.flo_id,'flo_name',f.name,'subject_type',l.subject_type,'subject_id',l.subject_id,
    'contact_id',l.contact_id,'expires_at',l.expires_at,'actions',l.actions,'now',tenant_now()) INTO result FROM flos f WHERE f.tenant_id=l.tenant_id AND f.id=l.flo_id;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.resolve_flo_link(text) TO lumbung_app;

CREATE FUNCTION lumbung.read_private_media(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); m media_files; l flo_access_links;
BEGIN
  SELECT * INTO m FROM media_files WHERE tenant_id=t AND id=p_id AND deletion_state='ACTIVE';
  IF m.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF current_actor_kind()='FLO_LINK' THEN
    SELECT * INTO l FROM flo_access_links WHERE tenant_id=t AND id=current_link_id();
    PERFORM assert_flo_scope(l.flo_id,m.subject_id,'evidence.submit');
  ELSIF m.uploader_actor IS DISTINCT FROM current_user_id() THEN PERFORM require_cap('media.sensitive.read');
  ELSE PERFORM require_cap(CASE WHEN m.purpose='AGREEMENT' THEN 'agreement.upload' WHEN m.purpose='COUNT' THEN 'inventory.adjust.request' ELSE 'evidence.submit' END);
  END IF;
  PERFORM append_audit('PRIVATE_MEDIA_ACCESSED','MEDIA',m.id,NULL);
  RETURN jsonb_build_object('id',m.id,'storage_key',m.storage_key,'mime',m.mime,'bytes',m.bytes);
END $$;
GRANT EXECUTE ON FUNCTION lumbung.read_private_media(uuid) TO lumbung_app;
