-- Recipient-side organoleptic checks are recorded independently from quantities.
-- They are evidence of the FLO's receiving decision, not a claim of laboratory safety.

ALTER TABLE lumbung.flo_receipts
  ADD COLUMN inspection_observations jsonb,
  ADD COLUMN inspection_outcome text
    CHECK (inspection_outcome IN ('ACCEPTED','PARTIAL','REJECTED'));

CREATE OR REPLACE FUNCTION lumbung.validate_receipt_inspection(
  p jsonb,
  accepted numeric,
  rejected numeric,
  dispatched numeric
) RETURNS text
LANGUAGE plpgsql
SET search_path = lumbung, pg_temp AS $$
DECLARE
  inspection jsonb := p->'inspection';
  finding text;
  has_concern boolean := false;
  key text;
BEGIN
  IF accepted IS NULL OR rejected IS NULL OR dispatched IS NULL THEN
    PERFORM lb_raise('BAD_REQUEST', '{"message":"Receipt quantities are required"}');
  END IF;
  IF jsonb_typeof(inspection) IS DISTINCT FROM 'object' THEN
    PERFORM lb_raise('BAD_REQUEST', '{"message":"Recipient inspection is required"}');
  END IF;

  FOREACH key IN ARRAY ARRAY['smell','appearance','texture','packaging'] LOOP
    finding := inspection->>key;
    IF finding IS NULL OR finding NOT IN ('PASS','CONCERN') THEN
      PERFORM lb_raise('BAD_REQUEST', jsonb_build_object('message','Invalid recipient inspection finding','field',key)::text);
    END IF;
    has_concern := has_concern OR finding='CONCERN';
  END LOOP;

  finding := inspection->>'taste';
  IF finding IS NULL OR finding NOT IN ('NOT_PERFORMED','PASS','CONCERN') THEN
    PERFORM lb_raise('BAD_REQUEST', '{"message":"Invalid taste inspection finding"}');
  END IF;
  has_concern := has_concern OR finding='CONCERN';

  IF has_concern AND (
    rejected<=0
    OR length(trim(coalesce(inspection->>'notes','')))<3
  ) THEN
    PERFORM lb_raise('RECIPIENT_INSPECTION_FAILED', '{"message":"A recipient inspection concern requires a rejected quantity and observations"}');
  END IF;

  RETURN CASE
    WHEN accepted=0 THEN 'REJECTED'
    WHEN accepted<dispatched OR rejected>0 THEN 'PARTIAL'
    ELSE 'ACCEPTED'
  END;
END $$;

-- The public command wrapper validates and persists the inspection while the
-- existing route-specific functions continue to own quantity and ledger logic.
CREATE OR REPLACE FUNCTION lumbung.direct_receive(p_id uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql
SET search_path=lumbung,pg_temp AS $$
DECLARE
  route_name text;
  total numeric;
  accepted numeric;
  rejected numeric;
  outcome text;
  result jsonb;
BEGIN
  SELECT d.route, sum(dl.dispatched_qty)
    INTO route_name,total
    FROM deliveries d
    JOIN delivery_lines dl ON dl.tenant_id=d.tenant_id AND dl.delivery_id=d.id AND NOT dl.cancelled
   WHERE d.tenant_id=current_tenant() AND d.id=p_id
   GROUP BY d.route;
  IF route_name IS NULL OR total IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}');END IF;

  accepted:=(p->>'accepted_quantity')::numeric;
  rejected:=(p->>'rejected_quantity')::numeric;
  outcome:=validate_receipt_inspection(p,accepted,rejected,total);

  IF route_name='WAREHOUSE_OUTBOUND' THEN
    result:=receive_batch_delivery(p_id,p);
  ELSE
    result:=receive_direct_delivery(p_id,p);
  END IF;

  UPDATE flo_receipts
     SET inspection_observations=p->'inspection',inspection_outcome=outcome
   WHERE tenant_id=current_tenant() AND id=(result->>'receipt_id')::uuid;
  RETURN result||jsonb_build_object('inspection_outcome',outcome);
END $$;

-- Quantity corrections preserve the receiving inspection rather than silently
-- discarding the original FLO observation snapshot.
CREATE OR REPLACE FUNCTION lumbung.copy_corrected_receipt_inspection() RETURNS trigger
LANGUAGE plpgsql
SET search_path=lumbung,pg_temp AS $$
DECLARE
  observations jsonb;
  outcome text;
BEGIN
  IF NEW.corrects_receipt_id IS NOT NULL AND NEW.inspection_observations IS NULL THEN
    SELECT r.inspection_observations,r.inspection_outcome
      INTO observations,outcome
      FROM flo_receipts r
     WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.corrects_receipt_id;
    NEW.inspection_observations:=observations;
    NEW.inspection_outcome:=outcome;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER receipt_inspection_correction_copy
BEFORE INSERT ON lumbung.flo_receipts
FOR EACH ROW EXECUTE FUNCTION lumbung.copy_corrected_receipt_inspection();

COMMENT ON COLUMN lumbung.flo_receipts.inspection_observations IS
  'FLO-reported smell, appearance, texture, packaging and optional taste findings at physical receipt.';
COMMENT ON COLUMN lumbung.flo_receipts.inspection_outcome IS
  'Quantity-aware receiving outcome; not laboratory certification or proof of later consumption.';
