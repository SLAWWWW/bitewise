import {handler} from '@/src/http/handler';
import {exportCsv} from '@/src/domain/imports/csv';
import {DomainError} from '@/src/db/errors';
const queries={
 flos:'SELECT code,name,flo_type,service_model,status,area,address,revision FROM lumbung.flos ORDER BY code',
 receipts:`SELECT r.id AS local_receipt_id,f.code AS flo_code,p.code AS product_code,s.code AS source_code,d.route,rl.accepted_qty::text AS quantity,rl.unit,r.received_at,r.origin FROM lumbung.flo_receipts r JOIN lumbung.receipt_lines rl ON rl.receipt_id=r.id AND rl.is_current JOIN lumbung.flos f ON f.id=r.flo_id JOIN lumbung.delivery_lines dl ON dl.id=rl.delivery_line_id LEFT JOIN lumbung.products p ON p.id=dl.product_id JOIN lumbung.deliveries d ON d.id=r.delivery_id JOIN lumbung.source_locations s ON s.id=d.source_location_id WHERE r.status='CURRENT' ORDER BY r.received_at,r.id`,
 inventory:'SELECT b.batch_code,p.code AS product_code,b.base_unit,b.external_lot,b.restriction,b.expires_at,b.handling_deadline,bb.account,bb.qty::text AS quantity FROM lumbung.inventory_batches b JOIN lumbung.products p ON p.id=b.product_id JOIN lumbung.batch_balances bb ON bb.batch_id=b.id ORDER BY b.batch_code,bb.account',
 audit:'SELECT occurred_at,action,subject_type,subject_id,actor_kind,actor_id,correlation_id,reason FROM lumbung.audit_events ORDER BY occurred_at,id',
 donations:'SELECT code,route,pickup_start,pickup_end,operational_state,reporting_state FROM lumbung.donation_orders ORDER BY created_at,id',
 reporting:'SELECT id,type,subject_id,anchor_at,due_at,state,resolved_timeliness,policy_version_id FROM lumbung.evidence_obligations ORDER BY due_at,id'
} as const;
export const GET=handler({capability:'audit.read',route:'/api/exports/[kind]'},async ctx=>{const kind=String(ctx.params.kind);if(!(kind in queries))throw new DomainError({code:'NOT_FOUND'});const rows=await ctx.tx(async c=>(await c.query(queries[kind as keyof typeof queries])).rows);const headers=rows[0]?Object.keys(rows[0]):['id'];return new Response(exportCsv(rows,headers),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="lumbung-${kind}.csv"`,'cache-control':'private, no-store'}});});
