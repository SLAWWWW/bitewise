SET LOCAL search_path=lumbung,pg_temp;

-- Configuration changes create immutable versions; historical evaluations keep
-- their original version. No UI control activates a live provider.
CREATE FUNCTION lumbung.admin_command(p_action text,p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); replay jsonb; result jsonb; old policy_versions; fresh uuid; cap text; member memberships;
BEGIN
 PERFORM require_cap(CASE WHEN p_action='member' THEN 'users.manage' ELSE 'policy.manage' END);
 IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 replay:=idem_begin(p_key,'admin:'||p_action,p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 IF length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
 IF p_action='policy' THEN
   SELECT * INTO old FROM policy_versions WHERE tenant_id=t AND id=p_id FOR UPDATE;
   IF old.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=t AND mode IN('DEMO','TEST')) THEN PERFORM lb_raise('LIVE_ACTIVATION_REQUIRED');END IF;
   IF jsonb_typeof(p->'body') IS DISTINCT FROM 'object' THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   IF old.kind='ALLOCATION' AND ((SELECT sum(value::numeric) FROM jsonb_each_text(p->'body'->'weights'))<>1 OR EXISTS(SELECT 1 FROM jsonb_each_text(p->'body'->'weights') WHERE value::numeric<0) OR (p->'body'->>'wave_size')::int NOT BETWEEN 1 AND 3) THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   IF old.kind='RETENTION' AND EXISTS(SELECT 1 FROM jsonb_each_text(p->'body') WHERE key LIKE '%retention_days' AND (value::int<1 OR value::int>3650)) THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   IF old.kind='REPORTING' AND EXISTS(SELECT 1 FROM jsonb_each_text(p->'body'->'due_rules') e WHERE e.value NOT IN('AT_RECEIPT','CALENDAR_NEXT_DAY_EOD','ROLLING_24H')) THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   INSERT INTO policy_versions(tenant_id,kind,code,version,body,status,approved_by,approved_at,supersedes_id,created_by)
     VALUES(t,old.kind,old.kind||'-'||gen_random_uuid(),'operator-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),p->'body','APPROVED_DEMO',current_user_id(),tenant_now(),old.id,current_user_id()) RETURNING id INTO fresh;
   UPDATE tenant_active_policies SET policy_version_id=fresh WHERE tenant_id=t AND kind=old.kind;
   result:=jsonb_build_object('id',fresh,'state','APPROVED_DEMO');
 ELSIF p_action='decision' THEN
   IF p->>'status' NOT IN('APPROVED','NOT_DECIDED') THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   UPDATE activation_decisions SET status=p->>'status',notes=p->>'reason',approved_by=CASE WHEN p->>'status'='APPROVED' THEN current_user_id() END,
     approved_at=CASE WHEN p->>'status'='APPROVED' THEN tenant_now() END WHERE tenant_id=t AND id=p_id;
   IF NOT FOUND THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   result:=jsonb_build_object('id',p_id,'state',p->>'status');
 ELSIF p_action='member' THEN
   PERFORM pg_advisory_xact_lock(hashtext(t::text),hashtext('memberships'));
   SELECT * INTO member FROM memberships WHERE tenant_id=t AND id=p_id FOR UPDATE;
   IF member.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   IF p->>'status' NOT IN('ACTIVE','SUSPENDED') OR jsonb_typeof(p->'capabilities') IS DISTINCT FROM 'array' THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   IF NOT ARRAY(SELECT jsonb_array_elements_text(p->'capabilities')) <@ known_capabilities() THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   IF member.user_id=current_user_id() AND (p->>'status'<>'ACTIVE' OR NOT (p->'capabilities' ? 'users.manage')) THEN PERFORM lb_raise('SELF_LOCKOUT_FORBIDDEN');END IF;
   UPDATE memberships SET capabilities=ARRAY(SELECT jsonb_array_elements_text(p->'capabilities')),status=p->>'status',role_label=p->>'role_label' WHERE tenant_id=t AND id=p_id;
   result:=jsonb_build_object('id',p_id,'state',p->>'status');
 ELSE PERFORM lb_raise('BAD_REQUEST');END IF;
 PERFORM append_audit('ADMIN_'||upper(p_action),'CONFIGURATION',p_id,NULL,p->>'reason',result);
 PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.admin_command(text,uuid,jsonb,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.resolve_task(p_id uuid,p_reason text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); task tasks; result jsonb; replay jsonb;
BEGIN
 PERFORM require_cap('audit.read');IF current_actor_kind()<>'USER' OR length(trim(p_reason))<3 THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 SELECT * INTO task FROM tasks WHERE tenant_id=t AND id=p_id FOR UPDATE;IF task.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 replay:=idem_begin(p_key,'resolve-task',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 UPDATE tasks SET state='DONE',payload=payload||jsonb_build_object('resolution_reason',p_reason,'resolved_by',current_user_id(),'resolved_at',tenant_now()) WHERE tenant_id=t AND id=p_id;
 PERFORM append_audit('TASK_RESOLVED','TASK',p_id,NULL,p_reason);result:=jsonb_build_object('id',p_id,'state','DONE');PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.resolve_task(uuid,text,text,text) TO lumbung_app;

-- Previewed canonical rows cannot be edited underneath the commit validator.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE table_schema='lumbung'
   AND table_name IN('import_rows','import_runs') AND grantee='lumbung_app' AND privilege_type IN('INSERT','UPDATE') LOOP
   EXECUTE format('REVOKE %s (%I) ON %I FROM lumbung_app',r.privilege_type,r.column_name,r.table_name);
 END LOOP;
END $$;
