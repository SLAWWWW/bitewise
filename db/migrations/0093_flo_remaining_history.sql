SET LOCAL search_path=lumbung,pg_temp;

CREATE OR REPLACE FUNCTION lumbung.flo_link_view() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=lumbung,pg_temp AS $$
DECLARE t uuid:=require_ctx(); l flo_access_links; result jsonb;
BEGIN
  PERFORM require_cap('evidence.submit');
  IF current_actor_kind()<>'FLO_LINK' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  SELECT * INTO l FROM flo_access_links WHERE tenant_id=t AND id=current_link_id();
  result:=jsonb_build_object('subject_type',l.subject_type,'subject_id',l.subject_id,'expires_at',l.expires_at,'now',tenant_now(),
    'flo_name',(SELECT name FROM flos WHERE tenant_id=t AND id=l.flo_id),'contact_id',l.contact_id,
    'offers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'code',o.code,'revision',o.revision,'state',o.state,'quantity',o.quantity::text,'unit',o.unit)) FROM offers o
      WHERE o.tenant_id=t AND l.subject_type='ALLOCATION' AND o.allocation_id=l.subject_id AND o.flo_id=l.flo_id),'[]'),
    'allocation',(SELECT jsonb_build_object('id',a.id,'revision',a.revision,'state',a.state,'quantity',a.quantity::text,'unit',a.unit) FROM allocations a
      WHERE a.tenant_id=t AND l.subject_type='ALLOCATION' AND a.id=l.subject_id AND a.flo_id=l.flo_id),
    'delivery',(SELECT jsonb_build_object('id',d.id,'code',d.code,'state',d.state,'revision',d.revision,'quantity',(SELECT sum(dispatched_qty)::text FROM delivery_lines WHERE tenant_id=t AND delivery_id=d.id),
      'unit',(SELECT unit FROM delivery_lines WHERE tenant_id=t AND delivery_id=d.id LIMIT 1)) FROM deliveries d WHERE d.tenant_id=t AND l.subject_type='DELIVERY' AND d.id=l.subject_id AND d.destination_flo_id=l.flo_id),
    'obligations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'type',o.type,'revision',o.revision,'state',o.state,'due_at',o.due_at,'subject_id',o.subject_id))
      FROM evidence_obligations o WHERE o.tenant_id=t AND l.subject_type='DELIVERY' AND obligation_delivery(o.id)=l.subject_id),'[]'),
    'receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'received_at',r.received_at,'lines',(SELECT jsonb_agg(jsonb_build_object('id',rl.id,'accepted_quantity',rl.accepted_qty::text,'unit',rl.unit,
      'remaining_quantity',(rl.accepted_qty-coalesce((SELECT sum(e.distributed_qty+e.loss_disposed_qty) FROM distribution_event_lines e JOIN receipt_lines previous ON previous.tenant_id=e.tenant_id AND previous.id=e.receipt_line_id WHERE e.tenant_id=t AND previous.delivery_line_id=rl.delivery_line_id),0))::text)) FROM receipt_lines rl WHERE rl.tenant_id=t AND rl.receipt_id=r.id AND rl.is_current)))
      FROM flo_receipts r WHERE r.tenant_id=t AND l.subject_type='DELIVERY' AND r.delivery_id=l.subject_id AND r.status='CURRENT'),'[]'));
  RETURN result;
END $$;
