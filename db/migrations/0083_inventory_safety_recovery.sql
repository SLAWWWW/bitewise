SET LOCAL search_path=lumbung,pg_temp;

CREATE OR REPLACE FUNCTION lumbung.batch_is_usable(p_id uuid,p_until timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=lumbung,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM inventory_batches b WHERE b.tenant_id=current_tenant() AND b.id=p_id AND b.restriction='NONE'
  AND least(b.expires_at,b.handling_deadline)>greatest(tenant_now(),p_until)
  AND NOT EXISTS(SELECT 1 FROM recalls r WHERE r.tenant_id=b.tenant_id AND (r.batch_id=b.id OR r.product_id=b.product_id) AND r.state='OPEN')
  AND NOT EXISTS(SELECT 1 FROM batch_balances bb WHERE bb.tenant_id=b.tenant_id AND bb.batch_id=b.id
   AND bb.qty IS DISTINCT FROM coalesce((SELECT sum(e.signed_qty) FROM movement_entries e WHERE e.tenant_id=bb.tenant_id AND e.batch_id=bb.batch_id AND e.account=bb.account),0))
  AND NOT EXISTS(SELECT 1 FROM movement_entries e WHERE e.tenant_id=b.tenant_id AND e.batch_id=b.id
   AND NOT EXISTS(SELECT 1 FROM batch_balances bb WHERE bb.tenant_id=e.tenant_id AND bb.batch_id=e.batch_id AND bb.account=e.account)))
$$;

ALTER FUNCTION lumbung.inventory_command(text,uuid,jsonb,text,text) RENAME TO inventory_command_core;
REVOKE EXECUTE ON FUNCTION lumbung.inventory_command_core(text,uuid,jsonb,text,text) FROM lumbung_app;
CREATE FUNCTION lumbung.inventory_command(p_action text,p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); result jsonb; a allocations; d record;
BEGIN
 IF p_action='dispose' THEN
  PERFORM require_cap('inventory.recall');IF current_actor_kind()<>'USER' OR length(trim(coalesce(p->>'reason','')))<3 OR p->>'from_account' NOT IN('AVAILABLE','QUARANTINE','EXCEPTION') THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
  result:=idem_begin(p_key,'dispose-stock',p_hash);IF result IS NOT NULL THEN RETURN result;END IF;
  PERFORM post_stock_transfer(p_id,p->>'from_account','DISPOSED',(p->>'quantity')::numeric,'DISPOSAL',p_key,p->>'reason');
  INSERT INTO dispositions(tenant_id,source_type,source_id,qty,unit,kind,decided_by,reason)
   SELECT t,'BATCH',id,(p->>'quantity')::numeric,base_unit,'DISPOSED',current_user_id(),p->>'reason' FROM inventory_batches WHERE tenant_id=t AND id=p_id;
  result:=jsonb_build_object('id',p_id,'state','DISPOSED');PERFORM append_audit('STOCK_DISPOSED','BATCH',p_id,NULL,p->>'reason',p);PERFORM idem_complete(p_key,result);RETURN result;
 END IF;
 result:=inventory_command_core(p_action,p_id,p,p_key,p_hash);
 IF p_action='recall' THEN
  FOR a IN SELECT al.* FROM allocations al WHERE al.tenant_id=t AND al.state IN('OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED')
   AND EXISTS(SELECT 1 FROM reservations r JOIN reservation_lines l ON l.tenant_id=r.tenant_id AND l.reservation_id=r.id WHERE r.tenant_id=t AND r.allocation_id=al.id AND l.batch_id=p_id AND l.state='ACTIVE') ORDER BY al.id LOOP
    PERFORM direct_release(a.id,'BATCH_RECALLED','EXCEPTION');
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'RECALL_AFFECTED','ALLOCATION',a.id,'CRITICAL','recall-allocation:'||a.id||':'||p_id,jsonb_build_object('batch_id',p_id)) ON CONFLICT DO NOTHING;
  END LOOP;
  FOR d IN SELECT DISTINCT delivery_id FROM delivery_lines WHERE tenant_id=t AND batch_id=p_id LOOP
    INSERT INTO tasks(tenant_id,kind,subject_type,subject_id,severity,dedup_key,payload) VALUES(t,'RECALL_AFFECTED','DELIVERY',d.delivery_id,'CRITICAL','recall-delivery:'||d.delivery_id||':'||p_id,jsonb_build_object('batch_id',p_id,'physical_recovery_required',true)) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
 RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.inventory_command(text,uuid,jsonb,text,text) TO lumbung_app;
