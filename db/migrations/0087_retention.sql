SET LOCAL search_path=lumbung,pg_temp;
ALTER TABLE media_files ADD COLUMN purged_at timestamptz;
CREATE INDEX media_pending_purge ON media_files(tenant_id,retention_until,id) WHERE deletion_state='DELETED' AND purged_at IS NULL;
CREATE FUNCTION lumbung.mark_media_purged(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx();
BEGIN
 PERFORM require_cap('message.send');IF current_actor_kind() NOT IN('USER','WORKER') THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 UPDATE media_files SET purged_at=clock_timestamp() WHERE tenant_id=t AND id=p_id AND deletion_state='DELETED' AND purged_at IS NULL;
 IF FOUND THEN PERFORM append_audit('MEDIA_RETENTION_PURGED','MEDIA',p_id,NULL);END IF;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.mark_media_purged(uuid) TO lumbung_app;
