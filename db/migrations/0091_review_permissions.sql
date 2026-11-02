SET LOCAL search_path=lumbung,pg_temp;

CREATE OR REPLACE FUNCTION lumbung.resolve_task(p_id uuid,p_reason text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); task tasks; result jsonb; replay jsonb;
BEGIN
 PERFORM require_cap(CASE WHEN has_cap('users.manage') THEN 'users.manage' WHEN has_cap('reservation.release') THEN 'reservation.release' WHEN has_cap('inventory.adjust.approve') THEN 'inventory.adjust.approve' WHEN has_cap('evidence.review') THEN 'evidence.review' ELSE 'agreement.review' END);IF current_actor_kind()<>'USER' OR length(trim(p_reason))<3 THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 SELECT * INTO task FROM tasks WHERE tenant_id=t AND id=p_id FOR UPDATE;IF task.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 replay:=idem_begin(p_key,'resolve-task',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 UPDATE tasks SET state='DONE',payload=payload||jsonb_build_object('resolution_reason',p_reason,'resolved_by',current_user_id(),'resolved_at',tenant_now()) WHERE tenant_id=t AND id=p_id;
 PERFORM append_audit('TASK_RESOLVED','TASK',p_id,NULL,p_reason);result:=jsonb_build_object('id',p_id,'state','DONE');PERFORM idem_complete(p_key,result);RETURN result;
END $$;

CREATE OR REPLACE FUNCTION lumbung.read_private_media(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); m media_files; l flo_access_links;
BEGIN
  SELECT * INTO m FROM media_files WHERE tenant_id=t AND id=p_id AND deletion_state='ACTIVE';
  IF m.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  IF current_actor_kind()='FLO_LINK' THEN
    SELECT * INTO l FROM flo_access_links WHERE tenant_id=t AND id=current_link_id();
    PERFORM assert_flo_scope(l.flo_id,m.subject_id,'evidence.submit');
  ELSIF m.purpose='AGREEMENT' AND has_cap('agreement.review') THEN PERFORM require_cap('agreement.review');
  ELSIF m.purpose='COUNT' AND has_cap('inventory.adjust.approve') THEN PERFORM require_cap('inventory.adjust.approve');
  ELSIF m.uploader_actor IS DISTINCT FROM current_user_id() THEN PERFORM require_cap('media.sensitive.read');
  ELSE PERFORM require_cap(CASE WHEN m.purpose='AGREEMENT' THEN 'agreement.upload' WHEN m.purpose='COUNT' THEN 'inventory.adjust.request' ELSE 'evidence.submit' END);
  END IF;
  PERFORM append_audit('PRIVATE_MEDIA_ACCESSED','MEDIA',m.id,NULL);
  RETURN jsonb_build_object('id',m.id,'storage_key',m.storage_key,'mime',m.mime,'bytes',m.bytes);
END $$;
