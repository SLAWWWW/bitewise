SET LOCAL search_path=lumbung,pg_temp;
CREATE INDEX obligations_subject_lookup ON evidence_obligations(tenant_id,subject_type,subject_id);
CREATE FUNCTION lumbung.refresh_reporting_summary(p_delivery uuid) RETURNS void
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
DECLARE oid uuid; result text;
BEGIN
 FOR oid IN SELECT DISTINCT coalesce(i.order_id,b.donor_order_id) FROM delivery_lines dl LEFT JOIN donation_items i ON i.tenant_id=dl.tenant_id AND i.id=dl.item_id LEFT JOIN inventory_batches b ON b.tenant_id=dl.tenant_id AND b.id=dl.batch_id WHERE dl.tenant_id=current_tenant() AND dl.delivery_id=p_delivery LOOP
  IF oid IS NULL THEN CONTINUE;END IF;
  SELECT CASE WHEN count(*)=0 THEN 'OPEN' WHEN bool_and(o.state IN('ACCEPTED','EXCUSED')) THEN 'COMPLETE'
    WHEN bool_or(o.state IN('SUBMITTED','UNDER_REVIEW')) THEN 'UNDER_REVIEW' ELSE 'OPEN' END INTO result
  FROM (
   SELECT eo.state FROM evidence_obligations eo WHERE eo.tenant_id=current_tenant() AND eo.subject_type='DELIVERY' AND eo.subject_id IN(
    SELECT dl.delivery_id FROM delivery_lines dl LEFT JOIN donation_items i ON i.tenant_id=dl.tenant_id AND i.id=dl.item_id LEFT JOIN inventory_batches b ON b.tenant_id=dl.tenant_id AND b.id=dl.batch_id WHERE dl.tenant_id=current_tenant() AND coalesce(i.order_id,b.donor_order_id)=oid)
   UNION ALL
   SELECT eo.state FROM evidence_obligations eo JOIN distribution_events e ON e.tenant_id=eo.tenant_id AND e.id=eo.subject_id JOIN flo_receipts r ON r.tenant_id=e.tenant_id AND r.id=e.receipt_id
    WHERE eo.tenant_id=current_tenant() AND eo.subject_type='DISTRIBUTION_EVENT' AND r.delivery_id IN(
     SELECT dl.delivery_id FROM delivery_lines dl LEFT JOIN donation_items i ON i.tenant_id=dl.tenant_id AND i.id=dl.item_id LEFT JOIN inventory_batches b ON b.tenant_id=dl.tenant_id AND b.id=dl.batch_id WHERE dl.tenant_id=current_tenant() AND coalesce(i.order_id,b.donor_order_id)=oid)
  ) o;
  IF result='COMPLETE' AND EXISTS(SELECT 1 FROM deliveries d JOIN delivery_lines dl ON dl.tenant_id=d.tenant_id AND dl.delivery_id=d.id LEFT JOIN donation_items i ON i.tenant_id=dl.tenant_id AND i.id=dl.item_id LEFT JOIN inventory_batches b ON b.tenant_id=dl.tenant_id AND b.id=dl.batch_id
    WHERE d.tenant_id=current_tenant() AND coalesce(i.order_id,b.donor_order_id)=oid AND NOT EXISTS(SELECT 1 FROM distribution_events e JOIN flo_receipts r ON r.tenant_id=e.tenant_id AND r.id=e.receipt_id WHERE e.tenant_id=d.tenant_id AND r.delivery_id=d.id AND NOT e.planned)) THEN result:='DISTRIBUTION_STATUS_UNKNOWN';END IF;
  UPDATE donation_orders SET reporting_state=result WHERE tenant_id=current_tenant() AND id=oid AND reporting_state IS DISTINCT FROM result;
 END LOOP;
END $$;
CREATE FUNCTION lumbung.tg_refresh_report_summary() RETURNS trigger
LANGUAGE plpgsql SET search_path=lumbung,pg_temp AS $$
BEGIN
 IF current_actor_kind()<>'SYSTEM' AND current_tenant()=NEW.tenant_id THEN PERFORM refresh_reporting_summary(obligation_delivery(NEW.id));END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refresh_report_summary AFTER INSERT OR UPDATE OF state ON evidence_obligations FOR EACH ROW EXECUTE FUNCTION tg_refresh_report_summary();
