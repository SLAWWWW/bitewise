import 'server-only';
import type { Queryable } from '@/src/db/types';
import type { Plan } from '@/src/domain/allocation/planner';
export interface DonationItem { id: string; description: string; quantity: string | null; available_quantity?: string; unit: string | null; safety_state: string; revision: number; distribute_by: string; missing_fields: string[] }
export interface Donation { id: string; code: string; donor_name: string; source_name: string; route: string; operational_state: string; reporting_state: string | null; revision: number; pickup_start: string; pickup_end: string; items: DonationItem[] }
export interface Run { id: string; item_id: string; result: Plan; created_at: string; order_id: string | null; order_code: string }
export interface Offer { id: string; code: string; flo_id: string; flo_name: string; contact_id: string; quantity: string; unit: string; state: string; revision: number; expires_at: string }
export interface Allocation { id: string; code: string; flo_id: string; flo_name: string; state: string; quantity: string; unit: string; revision: number; contact_id: string | null; transport_method: string | null; fee_idr: number | null; quote_status: string | null; delivery_id: string | null }
export interface Campaign { id: string; item_id: string; state: string; revision: number; offers: Offer[]; allocations: Allocation[] }
export interface Delivery { id: string; code: string; state: string; route: string; flo_name: string; revision: number; dispatched_at: string | null; received_at: string | null; planned_arrival_at: string; lines: { allocated_qty: string; dispatched_qty: string | null; unit: string; description: string; allocation_id: string }[]; obligations: { id: string; type: string; state: string; due_at: string }[] }
export interface IntakeReferences { donors: { id: string; name: string }[]; sources: { id: string; code: string; donor_id: string }[]; products: { id: string; code: string; name: string; base_unit: string }[]; now: string }

export async function listDonations(c: Queryable,offset=0): Promise<Donation[]> {
  const r = await c.query<{ row: Donation }>(`SELECT to_jsonb(o)||jsonb_build_object('donor_name',d.name,'source_name',s.code,
    'items',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('quantity',i.quantity::text) ORDER BY i.line_no) FROM lumbung.donation_items i WHERE i.order_id=o.id),'[]')) AS row
    FROM lumbung.donation_orders o JOIN lumbung.donors d ON d.id=o.donor_id LEFT JOIN lumbung.source_locations s ON s.id=o.source_location_id
    ORDER BY o.created_at DESC,o.id LIMIT 50 OFFSET $1`,[offset]);
  return r.rows.map(r => r.row);
}
export async function getDonation(c: Queryable, id: string): Promise<Donation | null> {
  const r = await c.query<{ row: Donation }>(`SELECT to_jsonb(o)||jsonb_build_object('donor_name',d.name,'source_name',s.code,
    'items',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('quantity',i.quantity::text,'available_quantity',
      greatest(0,i.quantity-coalesce((SELECT sum(a.quantity) FROM lumbung.allocations a WHERE a.item_id=i.id
        AND a.state NOT IN('PROPOSED','CANCELLED','EXPIRED','EXCEPTION')),0))::text) ORDER BY i.line_no) FROM lumbung.donation_items i WHERE i.order_id=o.id),'[]')) AS row
    FROM lumbung.donation_orders o JOIN lumbung.donors d ON d.id=o.donor_id LEFT JOIN lumbung.source_locations s ON s.id=o.source_location_id WHERE o.id=$1::uuid`,[id]);
  return r.rows[0]?.row ?? null;
}
export async function intakeReferences(c: Queryable): Promise<IntakeReferences> {
  const r = await c.query<{ row: IntakeReferences }>(`SELECT jsonb_build_object('donors',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY code) FROM lumbung.donors),
    'sources',(SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'donor_id',donor_id) ORDER BY code) FROM lumbung.source_locations WHERE kind='DONOR_SITE'),
    'products',(SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'base_unit',base_unit) ORDER BY code) FROM lumbung.products),
    'now',lumbung.tenant_now()) AS row`);
  return r.rows[0].row;
}
export async function listRuns(c: Queryable, orderId: string | null = null,offset=0): Promise<Run[]> {
  return (await c.query<{ row: Run }>(`SELECT to_jsonb(r)||jsonb_build_object('order_id',i.order_id,'order_code',coalesce(o.code,'WAREHOUSE')) AS row FROM lumbung.allocation_runs r
    LEFT JOIN lumbung.donation_items i ON i.id=r.item_id LEFT JOIN lumbung.donation_orders o ON o.id=i.order_id
    WHERE ($1::uuid IS NULL OR i.order_id=$1) ORDER BY r.created_at DESC,r.id LIMIT 50 OFFSET $2`,[orderId,offset])).rows.map(r=>r.row);
}
export async function listCampaigns(c: Queryable, orderId: string | null = null,offset=0): Promise<Campaign[]> {
  return (await c.query<{ row: Campaign }>(`SELECT to_jsonb(c)||jsonb_build_object(
    'offers',coalesce((SELECT jsonb_agg(to_jsonb(o)||jsonb_build_object('quantity',o.quantity::text,'flo_name',f.name) ORDER BY o.code)
      FROM lumbung.offers o JOIN lumbung.flos f ON f.id=o.flo_id WHERE o.campaign_id=c.id),'[]'),
    'allocations',coalesce((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('quantity',a.quantity::text,'flo_name',f.name,
      'contact_id',(SELECT id FROM lumbung.flo_contacts WHERE flo_id=f.id AND verification_state='VERIFIED' AND consent_state='GRANTED' AND opted_out_at IS NULL ORDER BY id LIMIT 1),
      'transport_method',t.method,'fee_idr',t.confirmed_fee_idr,'quote_status',t.quote_status,
      'delivery_id',(SELECT delivery_id FROM lumbung.delivery_lines WHERE allocation_id=a.id ORDER BY id LIMIT 1)) ORDER BY a.code)
      FROM lumbung.allocations a JOIN lumbung.flos f ON f.id=a.flo_id LEFT JOIN lumbung.transport_arrangements t ON t.allocation_id=a.id WHERE a.campaign_id=c.id),'[]')) AS row
    FROM lumbung.outreach_campaigns c LEFT JOIN lumbung.donation_items i ON i.id=c.item_id
    WHERE ($1::uuid IS NULL OR i.order_id=$1) ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET $2`,[orderId,offset])).rows.map(r=>r.row);
}
export async function listDeliveries(c: Queryable, id: string | null = null,offset=0): Promise<Delivery[]> {
  return (await c.query<{ row: Delivery }>(`SELECT to_jsonb(d)||jsonb_build_object('flo_name',f.name,
    'lines',coalesce((SELECT jsonb_agg(jsonb_build_object('allocated_qty',dl.allocated_qty::text,'dispatched_qty',dl.dispatched_qty::text,
      'unit',dl.unit,'description',p.name,'allocation_id',dl.allocation_id)) FROM lumbung.delivery_lines dl LEFT JOIN lumbung.products p ON p.id=dl.product_id WHERE dl.delivery_id=d.id AND NOT dl.cancelled),'[]'),
    'obligations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'type',type,'state',state,'due_at',due_at)) FROM lumbung.evidence_obligations WHERE subject_id=d.id),'[]')) AS row
    FROM lumbung.deliveries d JOIN lumbung.flos f ON f.id=d.destination_flo_id WHERE ($1::uuid IS NULL OR d.id=$1) ORDER BY d.created_at DESC,d.id LIMIT 50 OFFSET $2`,[id,offset])).rows.map(r=>r.row);
}
