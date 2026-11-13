-- 0095_volunteer_dispatch: volunteer profiles and a controlled route-claim / execution layer.
-- Volunteers can move an already-approved DIRECT delivery; they cannot allocate food,
-- approve dispatch, receive on behalf of an FLO, or operate warehouse stock.

SET LOCAL search_path = lumbung, pg_temp;

CREATE OR REPLACE FUNCTION lumbung.known_capabilities() RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT ARRAY[
    'flo.read','flo.edit','need.propose','need.confirm','agreement.upload','agreement.review',
    'donation.create','donation.validate','allocation.run','outreach.approve','campaign.start','offer.respond',
    'transport.edit','dispatch.approve','delivery.dispatch','delivery.receive',
    'volunteer.read','volunteer.manage','route.read','route.manage','route.claim','route.progress',
    'reservation.release','receipt.correct','receipt.correct.approve',
    'inventory.receive','inventory.inspect','inventory.quarantine_release','inventory.pick',
    'inventory.adjust.request','inventory.adjust.approve','inventory.recall',
    'evidence.submit','evidence.review','evidence.excuse','conversation.takeover','message.send',
    'import.preview','import.commit','policy.manage','users.manage','audit.read','media.sensitive.read',
    'demo.clock','demo.reset'
  ]::text[] $$;

CREATE TABLE lumbung.volunteer_profiles (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES lumbung.users(id),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  vehicle_type       text NOT NULL CHECK (vehicle_type IN ('BICYCLE','MOTORBIKE','CAR','VAN')),
  max_load_kg        numeric(8,2) NOT NULL CHECK (max_load_kg > 0 AND max_load_kg <= 5000),
  refrigerated       boolean NOT NULL DEFAULT false,
  home_area          text NOT NULL CHECK (length(trim(home_area)) BETWEEN 2 AND 120),
  available_dows     smallint[] NOT NULL CHECK (cardinality(available_dows) > 0 AND available_dows <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  available_start    time NOT NULL,
  available_end      time NOT NULL,
  availability_note  text CHECK (availability_note IS NULL OR length(availability_note) <= 1000),
  revision           integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES lumbung.users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES lumbung.memberships(tenant_id, user_id),
  CHECK (available_end > available_start)
);
CREATE INDEX volunteer_profiles_status_idx ON lumbung.volunteer_profiles (tenant_id, status, user_id);
CREATE INDEX volunteer_profiles_user_fkx ON lumbung.volunteer_profiles (user_id);
CREATE INDEX volunteer_profiles_created_by_fkx ON lumbung.volunteer_profiles (created_by);

CREATE TABLE lumbung.volunteer_routes (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  delivery_id           uuid NOT NULL,
  volunteer_user_id     uuid,
  state                 text NOT NULL DEFAULT 'OPEN' CHECK (state IN (
                          'OPEN','CLAIMED','EN_ROUTE_TO_PICKUP','AT_PICKUP','PICKED_UP',
                          'EN_ROUTE_TO_DROPOFF','AT_DROPOFF','HANDOFF_RECORDED','FAILED','CANCELLED')),
  published_at          timestamptz NOT NULL,
  published_by          uuid NOT NULL REFERENCES lumbung.users(id),
  claimed_at            timestamptz,
  assigned_by           uuid REFERENCES lumbung.users(id),
  started_at            timestamptz,
  pickup_arrived_at     timestamptz,
  picked_up_at          timestamptz,
  dropoff_arrived_at    timestamptz,
  handoff_at            timestamptz,
  handoff_note          text CHECK (handoff_note IS NULL OR length(handoff_note) <= 1000),
  failure_code          text CHECK (failure_code IS NULL OR failure_code IN ('NO_SHOW','VEHICLE','FOOD_UNAVAILABLE','SAFETY','ACCESS','OTHER')),
  failure_note          text CHECK (failure_note IS NULL OR length(failure_note) <= 1000),
  revision              integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES lumbung.users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, delivery_id),
  FOREIGN KEY (tenant_id, delivery_id) REFERENCES lumbung.deliveries(tenant_id, id),
  FOREIGN KEY (tenant_id, volunteer_user_id) REFERENCES lumbung.volunteer_profiles(tenant_id, user_id),
  CHECK ((state = 'OPEN' AND volunteer_user_id IS NULL) OR state <> 'OPEN'),
  CHECK (state = 'OPEN' OR state IN ('FAILED','CANCELLED') OR volunteer_user_id IS NOT NULL)
);
CREATE INDEX volunteer_routes_state_idx ON lumbung.volunteer_routes (tenant_id, state, published_at, id);
CREATE INDEX volunteer_routes_volunteer_idx ON lumbung.volunteer_routes (tenant_id, volunteer_user_id, state, id);
CREATE INDEX volunteer_routes_volunteer_user_fkx ON lumbung.volunteer_routes (volunteer_user_id);
CREATE INDEX volunteer_routes_published_by_fkx ON lumbung.volunteer_routes (published_by);
CREATE INDEX volunteer_routes_assigned_by_fkx ON lumbung.volunteer_routes (assigned_by);
CREATE INDEX volunteer_routes_created_by_fkx ON lumbung.volunteer_routes (created_by);

SELECT lumbung.apply_tenant_rls('lumbung.volunteer_profiles');
SELECT lumbung.apply_tenant_rls('lumbung.volunteer_routes');

CREATE FUNCTION lumbung.volunteer_command(p_action text, p_subject uuid, p jsonb, p_key text, p_hash text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = lumbung, pg_temp
  AS $$
  DECLARE
    t uuid := require_ctx();
    cap text;
    replay jsonb;
    result jsonb;
    before_facts jsonb;
    r volunteer_routes;
    d deliveries;
    profile volunteer_profiles;
    volunteer_id uuid;
    display_name text;
    next_state text;
    next_revision integer;
    dispatch_result jsonb;
  BEGIN
    cap := CASE
      WHEN p_action = 'profile' THEN 'volunteer.manage'
      WHEN p_action IN ('publish','assign','cancel') THEN 'route.manage'
      WHEN p_action IN ('claim','release') THEN 'route.claim'
      WHEN p_action IN ('start','arrive-pickup','pickup','depart-dropoff','arrive-dropoff','handoff','fail') THEN 'route.progress'
    END;
    IF cap IS NULL THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
    PERFORM require_cap(cap);
    IF current_actor_kind() <> 'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
    IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED','{"http":400}'); END IF;
    replay := idem_begin(p_key, 'volunteer:' || p_action,
      canonical_hash(jsonb_build_object('subject',p_subject,'payload',p,'hash',p_hash)));
    IF replay IS NOT NULL THEN RETURN replay; END IF;

    IF p_action = 'profile' THEN
      IF p->>'status' NOT IN ('ACTIVE','SUSPENDED')
         OR p->>'vehicle_type' NOT IN ('BICYCLE','MOTORBIKE','CAR','VAN')
         OR coalesce((p->>'max_load_kg')::numeric,0) <= 0
         OR length(trim(coalesce(p->>'home_area',''))) < 2
         OR jsonb_typeof(p->'available_dows') IS DISTINCT FROM 'array'
         OR coalesce((p->>'available_start')::time, time '00:00') >= coalesce((p->>'available_end')::time, time '00:00') THEN
        PERFORM lb_raise('BAD_REQUEST');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id=t AND m.user_id=p_subject AND m.status='ACTIVE'
                     AND 'route.claim'=ANY(m.capabilities) AND 'route.progress'=ANY(m.capabilities)) THEN
        PERFORM lb_raise('VOLUNTEER_MEMBERSHIP_REQUIRED');
      END IF;
      IF p->>'status'='SUSPENDED' AND EXISTS (
        SELECT 1 FROM volunteer_routes vr WHERE vr.tenant_id=t AND vr.volunteer_user_id=p_subject
          AND vr.state NOT IN ('HANDOFF_RECORDED','FAILED','CANCELLED')) THEN
        PERFORM lb_raise('VOLUNTEER_HAS_ACTIVE_ROUTE');
      END IF;
      SELECT to_jsonb(vp) INTO before_facts FROM volunteer_profiles vp WHERE vp.tenant_id=t AND vp.user_id=p_subject;
      INSERT INTO volunteer_profiles(tenant_id,user_id,status,vehicle_type,max_load_kg,refrigerated,home_area,
        available_dows,available_start,available_end,availability_note,created_by)
      VALUES(t,p_subject,p->>'status',p->>'vehicle_type',(p->>'max_load_kg')::numeric,coalesce((p->>'refrigerated')::boolean,false),
        trim(p->>'home_area'),ARRAY(SELECT jsonb_array_elements_text(p->'available_dows')::smallint),
        (p->>'available_start')::time,(p->>'available_end')::time,nullif(trim(p->>'availability_note'),''),current_user_id())
      ON CONFLICT (tenant_id,user_id) DO UPDATE SET
        status=excluded.status,vehicle_type=excluded.vehicle_type,max_load_kg=excluded.max_load_kg,
        refrigerated=excluded.refrigerated,home_area=excluded.home_area,available_dows=excluded.available_dows,
        available_start=excluded.available_start,available_end=excluded.available_end,
        availability_note=excluded.availability_note,revision=volunteer_profiles.revision+1,updated_at=tenant_now()
      RETURNING to_jsonb(volunteer_profiles) INTO result;
      PERFORM append_audit('VOLUNTEER_PROFILE_SAVED','VOLUNTEER',p_subject,(result->>'revision')::int,NULL,
        jsonb_build_object('request',p,'result',result),before_facts,result);
      PERFORM emit_event('VOLUNTEER_PROFILE_SAVED','VOLUNTEER',p_subject,(result->>'revision')::int,result);
      PERFORM idem_complete(p_key,result);
      RETURN result;
    END IF;

    IF p_action = 'publish' THEN
      SELECT * INTO d FROM deliveries WHERE tenant_id=t AND id=p_subject FOR UPDATE;
      IF d.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
      IF d.route <> 'DIRECT' THEN PERFORM lb_raise('VOLUNTEER_ROUTE_DIRECT_ONLY'); END IF;
      IF d.state <> 'READY_FOR_PICKUP' THEN PERFORM lb_raise('INVALID_STATE'); END IF;
      volunteer_id := nullif(p->>'volunteer_user_id','')::uuid;
      IF volunteer_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM volunteer_profiles vp WHERE vp.tenant_id=t AND vp.user_id=volunteer_id AND vp.status='ACTIVE') THEN
        PERFORM lb_raise('VOLUNTEER_UNAVAILABLE');
      END IF;
      INSERT INTO volunteer_routes(tenant_id,delivery_id,volunteer_user_id,state,published_at,published_by,claimed_at,assigned_by,created_by)
      VALUES(t,d.id,volunteer_id,CASE WHEN volunteer_id IS NULL THEN 'OPEN' ELSE 'CLAIMED' END,tenant_now(),current_user_id(),
        CASE WHEN volunteer_id IS NULL THEN NULL ELSE tenant_now() END,
        CASE WHEN volunteer_id IS NULL THEN NULL ELSE current_user_id() END,current_user_id())
      RETURNING * INTO r;
    ELSE
      SELECT * INTO r FROM volunteer_routes WHERE tenant_id=t AND id=p_subject FOR UPDATE;
      IF r.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
      before_facts := to_jsonb(r);
      IF r.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;

      IF p_action = 'claim' THEN
        SELECT * INTO profile FROM volunteer_profiles WHERE tenant_id=t AND user_id=current_user_id();
        IF profile.id IS NULL OR profile.status <> 'ACTIVE' THEN PERFORM lb_raise('VOLUNTEER_UNAVAILABLE'); END IF;
        IF r.state <> 'OPEN' THEN PERFORM lb_raise('ROUTE_ALREADY_CLAIMED'); END IF;
        UPDATE volunteer_routes SET volunteer_user_id=current_user_id(),state='CLAIMED',claimed_at=tenant_now(),
          assigned_by=NULL,revision=revision+1,updated_at=tenant_now() WHERE tenant_id=t AND id=r.id RETURNING * INTO r;
      ELSIF p_action = 'release' THEN
        IF r.state <> 'CLAIMED' OR r.volunteer_user_id IS DISTINCT FROM current_user_id() THEN PERFORM lb_raise('INVALID_STATE'); END IF;
        UPDATE volunteer_routes SET volunteer_user_id=NULL,state='OPEN',claimed_at=NULL,assigned_by=NULL,
          revision=revision+1,updated_at=tenant_now() WHERE tenant_id=t AND id=r.id RETURNING * INTO r;
      ELSIF p_action = 'assign' THEN
        IF r.state NOT IN ('OPEN','CLAIMED') THEN PERFORM lb_raise('INVALID_STATE'); END IF;
        volunteer_id := nullif(p->>'volunteer_user_id','')::uuid;
        IF volunteer_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM volunteer_profiles vp WHERE vp.tenant_id=t AND vp.user_id=volunteer_id AND vp.status='ACTIVE') THEN
          PERFORM lb_raise('VOLUNTEER_UNAVAILABLE');
        END IF;
        UPDATE volunteer_routes SET volunteer_user_id=volunteer_id,state='CLAIMED',claimed_at=tenant_now(),assigned_by=current_user_id(),
          revision=revision+1,updated_at=tenant_now() WHERE tenant_id=t AND id=r.id RETURNING * INTO r;
      ELSIF p_action = 'cancel' THEN
        IF r.state NOT IN ('OPEN','CLAIMED') THEN PERFORM lb_raise('INVALID_STATE'); END IF;
        UPDATE volunteer_routes SET state='CANCELLED',failure_note=nullif(trim(p->>'note'),''),revision=revision+1,
          updated_at=tenant_now() WHERE tenant_id=t AND id=r.id RETURNING * INTO r;
      ELSE
        SELECT * INTO profile FROM volunteer_profiles WHERE tenant_id=t AND user_id=current_user_id();
        IF profile.id IS NULL OR profile.status <> 'ACTIVE' OR r.volunteer_user_id IS DISTINCT FROM current_user_id() THEN
          PERFORM lb_raise('ROUTE_NOT_ASSIGNED');
        END IF;
        next_state := CASE p_action
          WHEN 'start' THEN 'EN_ROUTE_TO_PICKUP'
          WHEN 'arrive-pickup' THEN 'AT_PICKUP'
          WHEN 'pickup' THEN 'PICKED_UP'
          WHEN 'depart-dropoff' THEN 'EN_ROUTE_TO_DROPOFF'
          WHEN 'arrive-dropoff' THEN 'AT_DROPOFF'
          WHEN 'handoff' THEN 'HANDOFF_RECORDED'
          WHEN 'fail' THEN 'FAILED' END;
        IF (p_action='start' AND r.state<>'CLAIMED')
           OR (p_action='arrive-pickup' AND r.state<>'EN_ROUTE_TO_PICKUP')
           OR (p_action='pickup' AND r.state<>'AT_PICKUP')
           OR (p_action='depart-dropoff' AND r.state<>'PICKED_UP')
           OR (p_action='arrive-dropoff' AND r.state<>'EN_ROUTE_TO_DROPOFF')
           OR (p_action='handoff' AND r.state<>'AT_DROPOFF')
           OR (p_action='fail' AND r.state IN ('OPEN','HANDOFF_RECORDED','FAILED','CANCELLED')) THEN
          PERFORM lb_raise('INVALID_STATE');
        END IF;
        IF p_action='fail' AND (p->>'failure_code' NOT IN ('NO_SHOW','VEHICLE','FOOD_UNAVAILABLE','SAFETY','ACCESS','OTHER')
           OR length(trim(coalesce(p->>'note','')))<3) THEN PERFORM lb_raise('BAD_REQUEST'); END IF;
        IF p_action='pickup' THEN
          SELECT * INTO d FROM deliveries WHERE tenant_id=t AND id=r.delivery_id FOR UPDATE;
          SELECT u.display_name INTO display_name FROM users u WHERE u.id=current_user_id();
          dispatch_result := direct_dispatch(d.id,jsonb_build_object('expected_revision',d.revision,'custodian',display_name));
          PERFORM append_audit('VOLUNTEER_DELIVERY_DISPATCHED','DELIVERY',d.id,(dispatch_result->>'revision')::int,NULL,
            jsonb_build_object('route_id',r.id,'result',dispatch_result),to_jsonb(d),dispatch_result);
        END IF;
        UPDATE volunteer_routes SET state=next_state,
          started_at=CASE WHEN p_action='start' THEN tenant_now() ELSE started_at END,
          pickup_arrived_at=CASE WHEN p_action='arrive-pickup' THEN tenant_now() ELSE pickup_arrived_at END,
          picked_up_at=CASE WHEN p_action='pickup' THEN tenant_now() ELSE picked_up_at END,
          dropoff_arrived_at=CASE WHEN p_action='arrive-dropoff' THEN tenant_now() ELSE dropoff_arrived_at END,
          handoff_at=CASE WHEN p_action='handoff' THEN tenant_now() ELSE handoff_at END,
          handoff_note=CASE WHEN p_action='handoff' THEN nullif(trim(p->>'note'),'') ELSE handoff_note END,
          failure_code=CASE WHEN p_action='fail' THEN p->>'failure_code' ELSE failure_code END,
          failure_note=CASE WHEN p_action='fail' THEN trim(p->>'note') ELSE failure_note END,
          revision=revision+1,updated_at=tenant_now()
        WHERE tenant_id=t AND id=r.id RETURNING * INTO r;
        IF p_action='fail' THEN
          INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,state,dedup_key,payload,created_by)
          VALUES(t,'VOLUNTEER_ROUTE_EXCEPTION','VOLUNTEER_ROUTE',r.id,'HIGH','OPEN','volunteer-route-failed:'||r.id,
            jsonb_build_object('delivery_id',r.delivery_id,'failure_code',r.failure_code,'note',r.failure_note),current_user_id())
          ON CONFLICT (tenant_id,dedup_key) DO NOTHING;
        END IF;
      END IF;
    END IF;

    next_revision := r.revision;
    result := to_jsonb(r) || jsonb_build_object('id',r.id,'delivery_id',r.delivery_id,'state',r.state,'revision',r.revision);
    PERFORM append_audit('VOLUNTEER_ROUTE_'||upper(replace(p_action,'-','_')),'VOLUNTEER_ROUTE',r.id,next_revision,
      coalesce(p->>'note',p->>'failure_code'),jsonb_build_object('request',p,'result',result),before_facts,result);
    PERFORM emit_event('VOLUNTEER_ROUTE_'||upper(replace(p_action,'-','_')),'VOLUNTEER_ROUTE',r.id,next_revision,result);
    PERFORM idem_complete(p_key,result);
    RETURN result;
  END
  $$;

GRANT EXECUTE ON FUNCTION lumbung.volunteer_command(text,uuid,jsonb,text,text) TO lumbung_app;
