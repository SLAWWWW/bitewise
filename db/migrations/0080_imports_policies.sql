SET LOCAL search_path=lumbung,pg_temp;
ALTER TABLE external_mappings ADD COLUMN source_revision text,ADD COLUMN identity_hash text;

CREATE FUNCTION lumbung.preview_import(p_kind text,p_rows jsonb,p_sha text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); replay jsonb; rid uuid; row_data jsonb; errors jsonb; n int:=0; bad int:=0; existing external_mappings; identity text; result jsonb; seen text[]:='{}';
BEGIN
 PERFORM require_cap('import.preview');IF current_actor_kind()<>'USER' OR p_kind NOT IN('RECEIPTS','FLOS','DONATIONS') THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN PERFORM lb_raise('BAD_REQUEST');END IF;
 replay:=idem_begin(p_key,'preview-import',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 INSERT INTO import_runs(tenant_id,kind,file_sha256,source_revision,created_by) VALUES(t,p_kind,p_sha,'CSV',current_user_id()) RETURNING id INTO rid;
 FOR row_data IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
   n:=n+1;errors:='[]';identity:=canonical_hash(row_data-ARRAY['source_revision','local_receipt_id']);
   IF coalesce(row_data->>'external_id','')='' OR row_data->>'external_id'=ANY(seen) THEN errors:=errors||'"EXTERNAL_ID_REQUIRED_OR_REPEATED"'::jsonb;END IF;
   seen:=array_append(seen,row_data->>'external_id');
   IF p_kind='RECEIPTS' THEN
     IF NOT EXISTS(SELECT 1 FROM flos WHERE tenant_id=t AND code=row_data->>'flo_code') THEN errors:=errors||'"FLO_NOT_FOUND"'::jsonb;END IF;
     IF NOT EXISTS(SELECT 1 FROM products WHERE tenant_id=t AND code=row_data->>'product_code') THEN errors:=errors||'"PRODUCT_NOT_FOUND"'::jsonb;END IF;
     IF NOT EXISTS(SELECT 1 FROM source_locations WHERE tenant_id=t AND code=row_data->>'source_code') THEN errors:=errors||'"SOURCE_NOT_FOUND"'::jsonb;END IF;
     IF EXISTS(SELECT 1 FROM source_locations WHERE tenant_id=t AND code=row_data->>'source_code' AND donor_id IS NULL) AND NOT EXISTS(SELECT 1 FROM donors WHERE tenant_id=t AND code=row_data->>'donor_code') THEN errors:=errors||'"DONOR_PROVENANCE_REQUIRED"'::jsonb;END IF;
     IF row_data->>'route' NOT IN('DIRECT','WAREHOUSE_OUTBOUND') OR row_data->>'route' IS NULL THEN errors:=errors||'"ROUTE_INVALID"'::jsonb;END IF;
     BEGIN
       IF (row_data->>'received_at')::timestamptz>tenant_now() OR row_data->>'received_at' IS NULL THEN errors:=errors||'"RECEIPT_TIME_INVALID"'::jsonb;END IF;
       IF (row_data->>'quantity')::numeric<=0 OR row_data->>'quantity' IS NULL THEN errors:=errors||'"QUANTITY_INVALID"'::jsonb;END IF;
       IF EXISTS(SELECT 1 FROM products WHERE tenant_id=t AND code=row_data->>'product_code' AND (unit_factor(id,row_data->>'unit',base_unit) IS NULL
         OR mod((row_data->>'quantity')::numeric*unit_factor(id,row_data->>'unit',base_unit),min_increment)<>0)) THEN errors:=errors||'"CONVERSION_MISSING_OR_INCREMENT"'::jsonb;END IF;
     EXCEPTION WHEN OTHERS THEN errors:=errors||'"VALUE_INVALID"'::jsonb;END;
   ELSIF p_kind='FLOS' THEN
     IF length(trim(coalesce(row_data->>'name','')))<3 OR row_data->>'flo_type' NOT IN('PANTI','NON_PANTI') OR row_data->>'area' NOT IN('JAKARTA','BOGOR','DEPOK','TANGERANG','BEKASI') THEN errors:=errors||'"PROFILE_INVALID"'::jsonb;END IF;
   ELSE
     IF NOT EXISTS(SELECT 1 FROM source_locations WHERE tenant_id=t AND code=row_data->>'source_code' AND kind='DONOR_SITE') OR NOT EXISTS(SELECT 1 FROM products WHERE tenant_id=t AND code=row_data->>'product_code') THEN errors:=errors||'"REFERENCE_INVALID"'::jsonb;END IF;
     BEGIN IF (row_data->>'quantity')::numeric<=0 OR (row_data->>'pickup_end')::timestamptz<=(row_data->>'pickup_start')::timestamptz THEN errors:=errors||'"VALUE_INVALID"'::jsonb;END IF;
     EXCEPTION WHEN OTHERS THEN errors:=errors||'"VALUE_INVALID"'::jsonb;END;
   END IF;
   SELECT * INTO existing FROM external_mappings WHERE tenant_id=t AND system=coalesce(nullif(row_data->>'system',''),'FOODCYCLE_CSV') AND entity_type=p_kind AND external_id=row_data->>'external_id';
   IF existing.id IS NOT NULL AND existing.identity_hash IS DISTINCT FROM identity THEN errors:=errors||'"EXTERNAL_REVISION_CONFLICT"'::jsonb;END IF;
   IF jsonb_array_length(errors)>0 THEN bad:=bad+1;END IF;
   INSERT INTO import_rows(tenant_id,run_id,row_no,raw,parsed,errors,duplicate_of,action,created_by)
     VALUES(t,rid,n,row_data,row_data||jsonb_build_object('_identity_hash',identity),errors,existing.internal_id,CASE WHEN existing.id IS NOT NULL THEN 'SKIP_DUPLICATE' ELSE 'CREATE' END,current_user_id());
 END LOOP;
 result:=jsonb_build_object('id',rid,'state','PREVIEWED','rows',n,'errors',bad);
 UPDATE import_runs SET summary=result WHERE tenant_id=t AND id=rid;PERFORM append_audit('IMPORT_PREVIEWED','IMPORT',rid,1,NULL,result);PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.preview_import(text,jsonb,text,text,text) TO lumbung_app;

CREATE FUNCTION lumbung.commit_import(p_id uuid,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); run import_runs; row_record import_rows; p jsonb; mapped external_mappings; replay jsonb; result jsonb; count_created int:=0; count_skipped int:=0;
 flo flos; prod products; source source_locations; qty numeric; received timestamptz; oid uuid; item uuid; aid uuid; manual uuid; did uuid; dlid uuid; receipt uuid; local_id uuid; pol policy_versions; tz text; donor uuid; dr text; conflict boolean:=false;
BEGIN
 PERFORM require_cap('import.commit');IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 SELECT * INTO run FROM import_runs WHERE tenant_id=t AND id=p_id FOR UPDATE;IF run.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
 replay:=idem_begin(p_key,'commit-import',p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 IF run.state='COMMITTED' THEN PERFORM idem_complete(p_key,run.summary);RETURN run.summary;END IF;
 IF run.state<>'PREVIEWED' OR EXISTS(SELECT 1 FROM import_rows WHERE tenant_id=t AND run_id=run.id AND jsonb_array_length(errors)>0) THEN PERFORM lb_raise('IMPORT_PREVIEW_ERRORS');END IF;
 IF run.kind='RECEIPTS' THEN PERFORM require_cap('outreach.approve');PERFORM require_cap('dispatch.approve');
 ELSIF run.kind='FLOS' THEN PERFORM require_cap('flo.edit');ELSE PERFORM require_cap('donation.create');END IF;
 -- Lock identity keys in a stable order before applying any business mutation.
 FOR row_record IN SELECT * FROM import_rows WHERE tenant_id=t AND run_id=run.id ORDER BY (parsed->>'external_id') COLLATE "C" LOOP
   p:=row_record.parsed;PERFORM pg_advisory_xact_lock(hashtext(t::text),hashtext(coalesce(p->>'system','FOODCYCLE_CSV')||run.kind||(p->>'external_id')));
   SELECT * INTO mapped FROM external_mappings WHERE tenant_id=t AND system=coalesce(nullif(p->>'system',''),'FOODCYCLE_CSV') AND entity_type=run.kind AND external_id=p->>'external_id';
   IF mapped.id IS NOT NULL AND mapped.identity_hash IS DISTINCT FROM p->>'_identity_hash' THEN conflict:=true;END IF;
 END LOOP;
 IF conflict THEN
   UPDATE import_runs SET state='FAILED',summary='{"state":"CONFLICT","reason":"EXTERNAL_REVISION_CONFLICT"}' WHERE tenant_id=t AND id=run.id;
   INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'IMPORT_CONFLICT','IMPORT',run.id,'HIGH','import-conflict:'||run.id,'{}') ON CONFLICT DO NOTHING;
   result:='{"state":"CONFLICT"}';PERFORM idem_complete(p_key,result);RETURN result;
 END IF;
 FOR row_record IN SELECT * FROM import_rows WHERE tenant_id=t AND run_id=run.id ORDER BY row_no LOOP
   p:=row_record.parsed;
   SELECT * INTO mapped FROM external_mappings WHERE tenant_id=t AND system=coalesce(nullif(p->>'system',''),'FOODCYCLE_CSV') AND entity_type=run.kind AND external_id=p->>'external_id';
   IF mapped.id IS NOT NULL THEN count_skipped:=count_skipped+1;CONTINUE;END IF;
   IF run.kind='RECEIPTS' THEN
     SELECT * INTO flo FROM flos WHERE tenant_id=t AND code=p->>'flo_code';SELECT * INTO prod FROM products WHERE tenant_id=t AND code=p->>'product_code';SELECT * INTO source FROM source_locations WHERE tenant_id=t AND code=p->>'source_code';
     qty:=round((p->>'quantity')::numeric*unit_factor(prod.id,p->>'unit',prod.base_unit),3);received:=(p->>'received_at')::timestamptz;
     IF qty IS NULL OR qty<=0 OR mod(qty,prod.min_increment)<>0 OR received>tenant_now() THEN PERFORM lb_raise('CONVERSION_MISSING');END IF;
     local_id:=nullif(p->>'local_receipt_id','')::uuid;
     IF local_id IS NOT NULL THEN
       IF NOT EXISTS(SELECT 1 FROM flo_receipts r JOIN receipt_lines rl ON rl.tenant_id=r.tenant_id AND rl.receipt_id=r.id AND rl.is_current JOIN delivery_lines dl ON dl.tenant_id=rl.tenant_id AND dl.id=rl.delivery_line_id
         WHERE r.tenant_id=t AND r.id=local_id AND r.flo_id=flo.id AND r.status='CURRENT' AND dl.product_id=prod.id AND rl.unit=prod.base_unit AND rl.accepted_qty=qty AND r.received_at=received) THEN PERFORM lb_raise('IMPORT_CORRELATION_INVALID');END IF;
       receipt:=local_id;
     ELSE
       donor:=source.donor_id;IF donor IS NULL THEN SELECT id INTO donor FROM donors WHERE tenant_id=t AND code=p->>'donor_code';END IF;IF donor IS NULL THEN PERFORM lb_raise('DONOR_PROVENANCE_REQUIRED');END IF;
       INSERT INTO donation_orders(tenant_id,code,donor_id,source_location_id,route,intake_channel,pickup_start,pickup_end,operational_state,reporting_state,external_ref,created_by)
         VALUES(t,'IMP-'||upper(substr(gen_random_uuid()::text,1,8)),donor,source.id,CASE WHEN p->>'route'='DIRECT' THEN 'DIRECT' ELSE 'WAREHOUSE_INBOUND' END,'CSV',received-interval '1 hour',received+interval '1 hour','CLOSED','UNDER_REVIEW',p->>'external_id',current_user_id()) RETURNING id INTO oid;
       INSERT INTO donation_items(tenant_id,order_id,line_no,product_id,category_id,description,quantity,unit,unit_kind,storage_req,distribute_by,safety_state,parse)
         VALUES(t,oid,1,prod.id,prod.category_id,prod.name,qty,prod.base_unit,prod.unit_kind,prod.storage_profile,received+interval '1 day','REVIEW_REQUIRED','{"historical_import":true}') RETURNING id INTO item;
       aid:=gen_random_uuid();INSERT INTO approvals(tenant_id,stage,subject_type,subject_id,subject_revision,input_hash,approver_id,approved_at,reason)
         VALUES(t,'MANUAL_ALLOCATION','ALLOCATION',aid,1,canonical_hash(p),current_user_id(),tenant_now(),'Review of imported historical facts; not a retrospective dispatch authorisation') RETURNING id INTO manual;
       INSERT INTO allocations(id,tenant_id,code,item_id,source_type,flo_id,category_id,quantity,unit,unit_kind,state,manual_approval_id,planned_service_date)
         VALUES(aid,t,'IMP-AL-'||upper(substr(gen_random_uuid()::text,1,8)),CASE WHEN p->>'route'='DIRECT' THEN item END,CASE WHEN p->>'route'='DIRECT' THEN 'DIRECT_ITEM' ELSE 'BATCH' END,flo.id,prod.category_id,qty,prod.base_unit,prod.unit_kind,'RECEIVED',manual,(received AT TIME ZONE 'Asia/Jakarta')::date);
       INSERT INTO approvals(tenant_id,stage,subject_type,subject_id,subject_revision,input_hash,approver_id,approved_at,reason)
         VALUES(t,'FINAL_DISPATCH','ALLOCATION',aid,1,canonical_hash(p),current_user_id(),tenant_now(),'Historical import review; operational dispatch not performed by Lumbung');
       INSERT INTO deliveries(tenant_id,code,route,source_location_id,destination_flo_id,state,custodian,dispatched_at,received_at)
         VALUES(t,'IMP-DO-'||upper(substr(gen_random_uuid()::text,1,8)),p->>'route',source.id,flo.id,'RECEIVED','FLO',received-interval '30 minutes',received) RETURNING id INTO did;
       INSERT INTO delivery_lines(tenant_id,delivery_id,allocation_id,item_id,product_id,category_id,unit,unit_kind,offered_qty,allocated_qty,dispatched_qty,picked_qty)
         VALUES(t,did,aid,CASE WHEN p->>'route'='DIRECT' THEN item END,prod.id,prod.category_id,prod.base_unit,prod.unit_kind,qty,qty,qty,qty) RETURNING id INTO dlid;
       INSERT INTO flo_receipts(tenant_id,delivery_id,flo_id,received_at,time_source,recorded_by_actor,origin)
         VALUES(t,did,flo.id,received,'IMPORTED',current_user_id(),'IMPORT') RETURNING id INTO receipt;
       INSERT INTO receipt_lines(tenant_id,receipt_id,delivery_line_id,flo_id,category_id,unit,received_at,accepted_qty) VALUES(t,receipt,dlid,flo.id,prod.category_id,prod.base_unit,received,qty);
       IF agreement_was_valid_at_for(t,flo.id,received) IS NULL THEN INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload)
         VALUES(t,'AGREEMENT_EXPIRED_AT_HANDOVER','DELIVERY',did,'HIGH','import-agreement:'||did,'{"historical_fact":true}') ON CONFLICT DO NOTHING;END IF;
       pol:=direct_policy('REPORTING');SELECT timezone INTO tz FROM tenants WHERE id=t;
       INSERT INTO evidence_obligations(tenant_id,type,subject_type,subject_id,anchor_kind,anchor_at,due_at,due_rule,timezone,policy_version_id,state)
         VALUES(t,'BAST','DELIVERY',did,'RECEIPT',received,received,'AT_RECEIPT',tz,pol.id,'UNDER_REVIEW'),
           (t,'RECEIPT_PHOTO','DELIVERY',did,'DISPATCH',received-interval '30 minutes',compute_due_at(pol.body->'due_rules'->>'RECEIPT_PHOTO',received-interval '30 minutes',tz),pol.body->'due_rules'->>'RECEIPT_PHOTO',tz,pol.id,'UNDER_REVIEW');
     END IF;
     local_id:=receipt;
   ELSIF run.kind='FLOS' THEN
     result:=create_flo(jsonb_build_object('code',p->>'external_id','name',p->>'name','flo_type',p->>'flo_type','service_model',coalesce(p->>'service_model','DISTRIBUTION'),'area',p->>'area','address',p->>'address'),NULL,NULL);local_id:=(result->>'flo_id')::uuid;
   ELSE
     SELECT * INTO prod FROM products WHERE tenant_id=t AND code=p->>'product_code';SELECT * INTO source FROM source_locations WHERE tenant_id=t AND code=p->>'source_code';
     result:=direct_create(jsonb_build_object('donor_id',source.donor_id,'source_location_id',source.id,'donation_reason','SURPLUS','pickup_start',p->>'pickup_start','pickup_end',p->>'pickup_end',
       'items',jsonb_build_array(jsonb_build_object('product_id',prod.id,'quantity',p->>'quantity','unit',p->>'unit','condition','UNKNOWN','distribute_by',p->>'distribute_by','prep_info','{}'::jsonb,'label_info','{}'::jsonb))));local_id:=(result->>'id')::uuid;
   END IF;
   IF local_id IS NULL THEN PERFORM lb_raise('IMPORT_CORRELATION_INVALID');END IF;
   INSERT INTO external_mappings(tenant_id,system,entity_type,external_id,internal_id,source_revision,identity_hash,created_by)
     VALUES(t,coalesce(nullif(p->>'system',''),'FOODCYCLE_CSV'),run.kind,p->>'external_id',local_id,p->>'source_revision',p->>'_identity_hash',current_user_id());count_created:=count_created+1;
 END LOOP;
 result:=jsonb_build_object('id',run.id,'state','COMMITTED','created',count_created,'skipped',count_skipped);
 UPDATE import_runs SET state='COMMITTED',summary=result WHERE tenant_id=t AND id=run.id;PERFORM append_audit('IMPORT_COMMITTED','IMPORT',run.id,1,NULL,result);PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.commit_import(uuid,text,text) TO lumbung_app;
