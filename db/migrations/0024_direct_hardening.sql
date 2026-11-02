SET LOCAL search_path = lumbung, pg_temp;

-- Profile edits and agreement review share these locks with operational checks.
-- No provider call takes place while they are held.
CREATE FUNCTION lumbung.lock_direct_recipient(p_flo uuid,p_category uuid) RETURNS void
LANGUAGE plpgsql SET search_path = lumbung, pg_temp AS $$
BEGIN
  PERFORM 1 FROM flo_category_capacities WHERE tenant_id=current_tenant() AND flo_id=p_flo AND category_id=p_category FOR UPDATE;
  PERFORM 1 FROM flos WHERE tenant_id=current_tenant() AND id=p_flo FOR SHARE;
  PERFORM 1 FROM agreements WHERE tenant_id=current_tenant() AND flo_id=p_flo ORDER BY id FOR SHARE;
END $$;

-- Corrections are possible until outreach has committed this item's facts.
CREATE FUNCTION lumbung.revise_direct_item(p_item uuid,p jsonb,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
DECLARE t uuid:=require_ctx(); i donation_items; o donation_orders; replay jsonb; result jsonb; before_facts jsonb;
BEGIN
  PERFORM require_cap('donation.validate');
  IF current_actor_kind()<>'USER' THEN PERFORM lb_raise('FORBIDDEN','{"http":403}'); END IF;
  IF p_key IS NULL THEN PERFORM lb_raise('IDEMPOTENCY_KEY_REQUIRED','{"http":400}'); END IF;
  replay:=idem_begin(p_key,'revise-direct-item',canonical_hash(jsonb_build_object('id',p_item,'payload',p,'hash',p_hash)));
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  SELECT * INTO i FROM donation_items WHERE tenant_id=t AND id=p_item FOR UPDATE;
  IF i.id IS NULL THEN PERFORM lb_raise('NOT_FOUND','{"http":404}'); END IF;
  PERFORM direct_policy('SAFETY');
  IF i.revision IS DISTINCT FROM (p->>'expected_revision')::int THEN PERFORM lb_raise('REVISION_CONFLICT'); END IF;
  before_facts:=to_jsonb(i);
  IF EXISTS(SELECT 1 FROM allocations WHERE tenant_id=t AND item_id=i.id AND state NOT IN('PROPOSED','CANCELLED','EXPIRED','EXCEPTION')) THEN
    PERFORM lb_raise('INVALID_STATE'); END IF;
  IF p->>'condition' NOT IN('GOOD','UNKNOWN','OUTER_PACKAGING_DAMAGE','INNER_SEAL_DAMAGED','SPOILED') OR p->>'condition' IS NULL THEN
    PERFORM lb_raise('BAD_REQUEST'); END IF;
  UPDATE donation_items SET condition=p->>'condition',prep_info=coalesce(p->'prep_info','{}'),label_info=coalesce(p->'label_info','{}'),
    safety_state='PENDING',missing_fields='{}',revision=revision+1 WHERE tenant_id=t AND id=i.id RETURNING * INTO i;
  UPDATE donation_orders SET operational_state='DRAFT',revision=revision+1 WHERE tenant_id=t AND id=i.order_id RETURNING * INTO o;
  UPDATE approvals SET invalidated_at=tenant_now(),invalidated_reason='SOURCE_REVISED'
    WHERE tenant_id=t AND stage='OUTREACH' AND invalidated_at IS NULL AND subject_id IN(SELECT id FROM outreach_campaigns WHERE tenant_id=t AND item_id=i.id);
  result:=jsonb_build_object('id',i.id,'revision',i.revision,'order_revision',o.revision,'state',i.safety_state);
  PERFORM append_audit('DONATION_ITEM_REVISED','DONATION_ITEM',i.id,i.revision,p->>'reason',
    jsonb_build_object('before',before_facts,'after',to_jsonb(i),'result',result),before_facts,to_jsonb(i));
  PERFORM emit_event('DONATION_ITEM_REVISED','DONATION_ITEM',i.id,i.revision,result); PERFORM idem_complete(p_key,result); RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION lumbung.revise_direct_item(uuid,jsonb,text,text) TO lumbung_app;
