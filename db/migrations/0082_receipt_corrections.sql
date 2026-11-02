SET LOCAL search_path=lumbung,pg_temp;
CREATE TABLE lumbung.receipt_correction_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 receipt_id uuid NOT NULL,proposed_lines jsonb NOT NULL,reason text NOT NULL,requester_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN('REQUESTED','APPROVED')),approver_id uuid,revision int NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,receipt_id) REFERENCES flo_receipts(tenant_id,id)
);
SELECT lumbung.apply_tenant_rls('lumbung.receipt_correction_requests');

CREATE FUNCTION lumbung.correct_receipt(p_action text,p_id uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); replay jsonb; request receipt_correction_requests; r flo_receipts; line jsonb; old receipt_lines; dl delivery_lines;
 fresh uuid; accepted numeric; rejected numeric; used numeric; delta numeric; result jsonb;
BEGIN
 PERFORM require_cap(CASE WHEN p_action='request' THEN 'receipt.correct' ELSE 'receipt.correct.approve' END);
 IF current_actor_kind()<>'USER' OR length(trim(coalesce(p->>'reason','')))<3 THEN PERFORM lb_raise('FORBIDDEN','{"http":403}');END IF;
 replay:=idem_begin(p_key,'receipt-correction:'||p_action,p_hash);IF replay IS NOT NULL THEN RETURN replay;END IF;
 IF p_action='request' THEN
   SELECT * INTO r FROM flo_receipts WHERE tenant_id=t AND id=p_id AND status='CURRENT' FOR UPDATE;
   IF r.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   INSERT INTO receipt_correction_requests(tenant_id,receipt_id,proposed_lines,reason,requester_id,created_by)
    VALUES(t,r.id,p->'lines',p->>'reason',current_user_id(),current_user_id()) RETURNING * INTO request;
   result:=jsonb_build_object('id',request.id,'state',request.state,'revision',request.revision);
 ELSIF p_action='approve' THEN
   SELECT * INTO request FROM receipt_correction_requests WHERE tenant_id=t AND id=p_id FOR UPDATE;
   IF request.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;
   IF request.requester_id=current_user_id() THEN PERFORM lb_raise('SELF_APPROVAL_FORBIDDEN');END IF;
   IF request.state<>'REQUESTED' OR request.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
   SELECT * INTO r FROM flo_receipts WHERE tenant_id=t AND id=request.receipt_id FOR UPDATE;
   IF r.status<>'CURRENT' THEN PERFORM lb_raise('REVISION_CONFLICT');END IF;
   IF jsonb_array_length(request.proposed_lines)<>(SELECT count(*) FROM receipt_lines WHERE tenant_id=t AND receipt_id=r.id AND is_current) THEN PERFORM lb_raise('BAD_REQUEST');END IF;
   UPDATE flo_receipts SET status='SUPERSEDED' WHERE tenant_id=t AND id=r.id;
   INSERT INTO flo_receipts(tenant_id,delivery_id,flo_id,received_at,time_source,recorded_by_actor,corrects_receipt_id,origin)
     VALUES(t,r.delivery_id,r.flo_id,r.received_at,r.time_source,current_user_id(),r.id,r.origin) RETURNING id INTO fresh;
   FOR line IN SELECT * FROM jsonb_array_elements(request.proposed_lines) LOOP
     SELECT * INTO old FROM receipt_lines WHERE tenant_id=t AND receipt_id=r.id AND id=(line->>'receipt_line_id')::uuid AND is_current FOR UPDATE;
     IF old.id IS NULL THEN PERFORM lb_raise('BAD_REQUEST');END IF;
     SELECT * INTO dl FROM delivery_lines WHERE tenant_id=t AND id=old.delivery_line_id FOR UPDATE;
     accepted:=(line->>'accepted_quantity')::numeric;rejected:=(line->>'rejected_quantity')::numeric;
     SELECT coalesce(sum(e.distributed_qty+e.loss_disposed_qty),0) INTO used FROM distribution_event_lines e JOIN receipt_lines l ON l.tenant_id=e.tenant_id AND l.id=e.receipt_line_id WHERE e.tenant_id=t AND l.delivery_line_id=dl.id;
     IF least(accepted,rejected)<0 OR accepted IS NULL OR rejected IS NULL OR accepted<used OR accepted+rejected>dl.dispatched_qty OR
       (dl.unit_kind='COUNT' AND (accepted<>trunc(accepted) OR rejected<>trunc(rejected))) THEN PERFORM lb_raise('RECEIPT_QUANTITY_INVALID');END IF;
     delta:=accepted-old.accepted_qty;
     IF dl.batch_id IS NOT NULL AND delta<>0 THEN PERFORM post_stock_transfer(dl.batch_id,CASE WHEN delta>0 THEN 'EXCEPTION' ELSE 'DELIVERED' END,CASE WHEN delta>0 THEN 'DELIVERED' ELSE 'EXCEPTION' END,abs(delta),'RECEIPT_CORRECTION',p_key||':'||old.id,p->>'reason');END IF;
     UPDATE receipt_lines SET is_current=false WHERE tenant_id=t AND id=old.id;
     INSERT INTO receipt_lines(tenant_id,receipt_id,delivery_line_id,flo_id,category_id,unit,received_at,accepted_qty,rejected_qty,discrepancy_reason)
       VALUES(t,fresh,dl.id,r.flo_id,old.category_id,old.unit,r.received_at,accepted,rejected,request.reason);
   END LOOP;
   UPDATE receipt_correction_requests SET state='APPROVED',approver_id=current_user_id(),revision=revision+1 WHERE tenant_id=t AND id=request.id;
   result:=jsonb_build_object('id',request.id,'receipt_id',fresh,'state','APPROVED','revision',request.revision+1);
 ELSE PERFORM lb_raise('BAD_REQUEST');END IF;
 PERFORM append_audit('RECEIPT_CORRECTION_'||upper(p_action),'RECEIPT',coalesce(r.id,request.receipt_id),NULL,p->>'reason',result);
 PERFORM idem_complete(p_key,result);RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.correct_receipt(text,uuid,jsonb,text,text) TO lumbung_app;
