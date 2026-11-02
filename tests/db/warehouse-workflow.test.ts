import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {scenario,idem} from '../setup/scenario';
import {ownerPool,closeOwnerPool,withOwner} from '../setup/db-helpers';
import {inventoryCommand,planRelease} from '@/src/application/inventory/commands';
import {runDue} from '@/src/jobs/run-due';
let f:Awaited<ReturnType<typeof scenario>>;let product:string;let warehouse:string;let storage:string;
beforeAll(async()=>{
 f=await scenario();const refs=await f.tx(async c=>(await c.query<{product:string;warehouse:string;storage:string}>(`SELECT p.id product,w.id warehouse,s.id storage FROM lumbung.products p CROSS JOIN lumbung.source_locations w JOIN lumbung.storage_locations s ON s.warehouse_id=w.id AND s.storage_profile='AMBIENT' WHERE p.code='BISKUIT' AND w.code='WH-JKU' LIMIT 1`)).rows[0]);({product,warehouse,storage}=refs);
});
afterAll(async()=>{if(f)await withOwner(c=>c.query('SELECT lumbung.demo_reset_begin($1)',[f.slug]));await closeOwnerPool();});
const inv=async(action:string,id:string|null,p:unknown,user='GUDANG1')=>{const key=idem();return f.tx(c=>inventoryCommand(c,action,id,p,{idempotencyKey:key.key,requestHash:key.hash}),user);};
async function inbound(qty:string,accepted=qty,held='0',rejected='0',expiry='2026-11-15T16:59:59Z'){
 const expected=await inv('inbound',null,{donor_id:f.refs.donor_id,source_location_id:f.refs.source_location_id,warehouse_id:warehouse,expected_at:'2026-10-26T02:00:00Z',donation_reason:'SURPLUS',items:[{product_id:product,quantity:qty,unit:'pack'}]});
 const line=await f.tx(async c=>(await c.query<{id:string}>('SELECT id FROM lumbung.inbound_lines WHERE inbound_id=$1',[expected.id])).rows[0]);
 const received=await inv('receive',expected.id,{expected_revision:1,reason:'Synthetic arrival and packaging inspection',complete:true,lines:[{inbound_line_id:line.id,actual_quantity:qty,accepted_quantity:accepted,quarantined_quantity:held,rejected_quantity:rejected,unit:'pack',storage_location_id:storage,lot:randomUUID(),expiry_at:expiry,condition:'GOOD',inspection_reason:'Intact packaging; label checked'}]});
 const batches=await f.tx(async c=>(await c.query<{id:string;restriction:string}>('SELECT id,restriction FROM lumbung.inventory_batches WHERE inspection_id=$1',[received.inspection_id])).rows);
 return {expected,received,batches};
}
it('SC04: expected inbound changes no stock; actual inspection splits 80/15/5',async()=>{
 const before=await f.tx(async c=>(await c.query<{n:number}>('SELECT count(*)::int n FROM lumbung.stock_movements')).rows[0].n);
 const result=await inbound('100','80','15','5');
 const balances=await f.tx(async c=>(await c.query<{account:string;qty:string}>('SELECT account,sum(qty)::text qty FROM lumbung.batch_balances WHERE batch_id=ANY($1::uuid[]) GROUP BY account',[result.batches.map(b=>b.id)])).rows);
 expect(Number(balances.find(b=>b.account==='AVAILABLE')?.qty)).toBe(80);expect(Number(balances.find(b=>b.account==='QUARANTINE')?.qty)).toBe(15);
 expect((await f.tx(c=>c.query('SELECT 1 FROM lumbung.dispositions WHERE source_type=\'INBOUND_LINE\' AND source_id IN(SELECT id FROM lumbung.inbound_lines WHERE inbound_id=$1) AND qty=5',[result.expected.id]))).rowCount).toBe(1);
 const after=await f.tx(async c=>(await c.query<{n:number}>('SELECT count(*)::int n FROM lumbung.stock_movements')).rows[0].n);expect(after-before).toBe(2);
});
it('SC05: reserves 30+10 by first expiry and preserves provenance through pickup and receipt',async()=>{
 await withOwner(c=>c.query(`UPDATE lumbung.inventory_batches SET restriction='QUARANTINED' WHERE tenant_id=$1 AND product_id=$2`,[f.ids.tenantId,product]));
 const first=await inbound('30','30','0','0','2026-11-05T16:59:59Z');const second=await inbound('50','50','0','0','2026-11-10T16:59:59Z');const flo=f.ids.id('flo','FLO-0006');
 await withOwner(async c=>{
   await c.query('UPDATE lumbung.flos SET allergen_exclusions=\'{}\',halal_required=false,storage_capabilities=\'{AMBIENT,CHILLED,FROZEN}\' WHERE id=$1',[flo]);
   await c.query(`UPDATE lumbung.flo_category_capacities SET unit='pack',per_event_capacity=100,distribution_capacity=100 WHERE tenant_id=$1 AND flo_id=$2 AND category_id=(SELECT category_id FROM lumbung.products WHERE id=$3)`,[f.ids.tenantId,flo,product]);
   await c.query(`UPDATE lumbung.flo_category_prefs SET preference='ACCEPT' WHERE tenant_id=$1 AND flo_id=$2 AND category_id=(SELECT category_id FROM lumbung.products WHERE id=$3)`,[f.ids.tenantId,flo,product]);
   await c.query(`INSERT INTO lumbung.availability_windows(tenant_id,flo_id,kind,dow,start_local,end_local) VALUES($1,$2,'RECEIVING',1,'08:00','20:00')`,[f.ids.tenantId,flo]);
 });
 const key=idem();const run=await f.tx(c=>planRelease(c,{warehouse_id:warehouse,product_id:product,quantity:'40',pickup_start:'2026-10-26T01:00:00Z',pickup_end:'2026-10-26T04:00:00Z',receipt_at:'2026-10-26T02:00:00Z',distribution_at:'2026-10-26T03:00:00Z'},{idempotencyKey:key.key,requestHash:key.hash}));
 const campaign=await f.command('draft',run.id,{lines:[{flo_id:flo,quantity:'40'}],reason:'Single practical collection for the FEFO scenario'});
 await f.command('approve-outreach',campaign.id,{expected_revision:1,reason:'Reviewed warehouse scope'});await f.command('start',campaign.id,{expected_revision:1});await runDue(f.ctx());
 const offer=await f.tx(async c=>(await c.query<{id:string;revision:number;contact_id:string;allocation_id:string}>('SELECT id,revision,contact_id,allocation_id FROM lumbung.offers WHERE campaign_id=$1',[campaign.id])).rows[0]);
 const reserved=await f.tx(async c=>(await c.query<{batch_id:string;quantity:string}>('SELECT batch_id,quantity::text FROM lumbung.reservation_lines WHERE reservation_id IN(SELECT id FROM lumbung.reservations WHERE allocation_id=$1) AND state=\'ACTIVE\' ORDER BY quantity DESC',[offer.allocation_id])).rows);
 expect(reserved.map(r=>[r.batch_id,Number(r.quantity)])).toEqual([[first.batches[0].id,30],[second.batches[0].id,10]]);
 await f.command('respond',offer.id,{expected_revision:offer.revision,response:'ACCEPT',quantity:'40'});
 const a=await f.tx(async c=>(await c.query<{revision:number}>('SELECT revision FROM lumbung.allocations WHERE id=$1',[offer.allocation_id])).rows[0]);
 const tr=await f.command('transport',offer.allocation_id,{expected_revision:a.revision,method:'SELF_PICKUP',decision:'ACCEPT',arranger:'FLO confirms warehouse collection',fee_idr:null,contact_id:offer.contact_id});
 const approval=await f.command('approve-dispatch',offer.allocation_id,{expected_revision:tr.revision,reason:'Confirmed warehouse dispatch'});
 const picks=await f.tx(async c=>(await c.query<{id:string;planned_qty:string}>('SELECT id,planned_qty::text FROM lumbung.pick_lines WHERE pick_list_id IN(SELECT id FROM lumbung.pick_lists WHERE delivery_id=$1)',[approval.delivery_id])).rows);
 const intent=idem();await f.sql('pick_delivery',[approval.delivery_id,JSON.stringify({expected_revision:1,lines:picks.map(p=>({pick_line_id:p.id,picked_quantity:p.planned_qty}))}),intent.key,intent.hash],'GUDANG1');
 const dispatched=await f.command('dispatch',approval.delivery_id!,{expected_revision:2,custodian:'Warehouse collection driver'});
 const receipt=await f.command('receive',dispatched.id,{expected_revision:dispatched.revision,accepted_quantity:'40',rejected_quantity:'0'});
 const actual=await f.tx(async c=>(await c.query<{qty:string;n:number}>('SELECT sum(accepted_qty)::text qty,count(*)::int n FROM lumbung.receipt_lines WHERE receipt_id=$1',[receipt.receipt_id])).rows[0]);expect(Number(actual.qty)).toBe(40);expect(actual.n).toBe(2);
 const totals=await f.tx(async c=>(await c.query<{account:string;qty:string}>('SELECT account,sum(qty)::text qty FROM lumbung.batch_balances WHERE batch_id=ANY($1::uuid[]) GROUP BY account',[[first.batches[0].id,second.batches[0].id]])).rows);
 expect(Number(totals.find(x=>x.account==='AVAILABLE')?.qty)).toBe(40);expect(Number(totals.find(x=>x.account==='DELIVERED')?.qty)).toBe(40);expect(Number(totals.find(x=>x.account==='RESERVED')?.qty)).toBe(0);
 await inv('return',first.batches[0].id,{quantity:'5',arrived:true,from_account:'DELIVERED',reason:'Five packs returned at the warehouse; held for inspection'});
 const held=await f.tx(async c=>(await c.query<{qty:string}>('SELECT qty::text FROM lumbung.batch_balances WHERE batch_id=$1 AND account=\'QUARANTINE\'',[first.batches[0].id])).rows[0]);expect(Number(held.qty)).toBe(5);
 const violations=await ownerPool().query('SELECT * FROM lumbung.verify_tenant_invariants($1)',[f.ids.tenantId]);expect(violations.rows).toEqual([]);
});
it('AC27: a distinct approver posts a balancing reversal and corrected receipt, replaying once',async()=>{
 const created=await inbound('20');const batch=created.batches[0].id;const media=randomUUID();let k=idem();
 await f.sql('register_media',[JSON.stringify({id:media,subject_id:batch,purpose:'COUNT',storage_key:`${f.ids.tenantId}/${media}`,sha256:'a'.repeat(64),mime:'image/png',bytes:100}),k.key,k.hash],'GUDANG1');
 const original=await f.tx(async c=>(await c.query<{id:string}>("SELECT m.id FROM lumbung.stock_movements m JOIN lumbung.movement_entries e ON e.movement_id=m.id WHERE e.batch_id=$1 AND e.account='AVAILABLE' AND m.type='RECEIPT'",[batch])).rows[0]);
 const request=await inv('adjust',null,{batch_id:batch,delta:'-2',media_id:media,reversal_of:original.id,reason:'Count evidence confirms eighteen packs rather than twenty'});
 await expect(inv('approve-adjust',request.id,{expected_revision:1,reason:'Requester must not approve'},'GUDANG1')).rejects.toMatchObject({code:'FORBIDDEN'});
 k=idem();const args=['approve-adjust',request.id,JSON.stringify({expected_revision:1,reason:'Independent recount confirms eighteen packs'}),k.key,k.hash];
 const result=await f.sql('inventory_command',args,'GUDANG2');expect(await f.sql('inventory_command',args,'GUDANG2')).toEqual(result);
 const balance=await f.tx(async c=>(await c.query<{qty:string}>("SELECT qty::text FROM lumbung.batch_balances WHERE batch_id=$1 AND account='AVAILABLE'",[batch])).rows[0]);expect(Number(balance.qty)).toBe(18);
 const movements=await f.tx(async c=>(await c.query<{type:string;reversal_of:string|null}>('SELECT DISTINCT m.id,m.type,m.reversal_of FROM lumbung.stock_movements m JOIN lumbung.movement_entries e ON e.movement_id=m.id WHERE e.batch_id=$1',[batch])).rows);expect(movements).toHaveLength(3);expect(movements.find(m=>m.type==='REVERSAL')?.reversal_of).toBe(original.id);
 expect((await ownerPool().query('SELECT * FROM lumbung.verify_tenant_invariants($1)',[f.ids.tenantId])).rows).toEqual([]);
});
it('AC22: recall freezes availability and disposal never makes returned food available',async()=>{
 const created=await inbound('12');const batch=created.batches[0].id;await inv('recall',batch,{reason:'Synthetic product incident confirmed by supervisor'},'GUDANG2');
 const eligible=await withOwner(async c=>{await c.query('BEGIN');try{await c.query("SELECT set_config('app.tenant_id',$1,true)",[f.ids.tenantId]);return (await c.query<{v:boolean}>("SELECT lumbung.batch_is_usable($1,'2026-10-26T03:00:00Z') v",[batch])).rows[0].v;}finally{await c.query('ROLLBACK');}});expect(eligible).toBe(false);
 await inv('dispose',batch,{quantity:'12',from_account:'AVAILABLE',reason:'Approved disposal of the recalled synthetic stock'},'GUDANG2');
 const rows=await f.tx(async c=>(await c.query<{account:string;qty:string}>('SELECT account,qty::text FROM lumbung.batch_balances WHERE batch_id=$1',[batch])).rows);expect(Number(rows.find(r=>r.account==='DISPOSED')?.qty)).toBe(12);expect(Number(rows.find(r=>r.account==='AVAILABLE')?.qty)).toBe(0);
});
it('AC24: simultaneous warehouse campaigns cannot claim the same final stock',async()=>{
 const fresh=await inbound('5');const batch=fresh.batches[0].id;const flo=f.ids.id('flo','FLO-0006');
 await withOwner(c=>c.query("UPDATE lumbung.inventory_batches SET restriction='QUARANTINED' WHERE tenant_id=$1 AND product_id=$2 AND id<>$3",[f.ids.tenantId,product,batch]));
 async function approvedCampaign(){const key=idem();const run=await f.tx(c=>planRelease(c,{warehouse_id:warehouse,product_id:product,quantity:'5',pickup_start:'2026-10-26T01:00:00Z',pickup_end:'2026-10-26T04:00:00Z',receipt_at:'2026-10-26T02:00:00Z',distribution_at:'2026-10-26T03:00:00Z'},{idempotencyKey:key.key,requestHash:key.hash}));
  const campaign=await f.command('draft',run.id,{lines:[{flo_id:flo,quantity:'5'}],reason:'Concurrency fixture with five backed packs'});await f.command('approve-outreach',campaign.id,{expected_revision:1,reason:'Independent review of source availability'});return campaign.id;}
 const first=await approvedCampaign();const second=await approvedCampaign();const outcomes=await Promise.allSettled([f.command('start',first,{expected_revision:1}),f.command('start',second,{expected_revision:1})]);expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
 const balances=await f.tx(async c=>(await c.query<{account:string;qty:string}>('SELECT account,qty::text FROM lumbung.batch_balances WHERE batch_id=$1',[batch])).rows);expect(Number(balances.find(r=>r.account==='AVAILABLE')?.qty)).toBe(0);expect(Number(balances.find(r=>r.account==='RESERVED')?.qty)).toBe(5);
 expect((await ownerPool().query('SELECT * FROM lumbung.verify_tenant_invariants($1)',[f.ids.tenantId])).rows).toEqual([]);
});
