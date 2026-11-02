import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {scenario,idem} from '../setup/scenario';
import {closeOwnerPool,withOwner,withAppTx} from '../setup/db-helpers';
import {hashToken} from '@/src/security/flo-link';
import {batches,inbounds,references,obligations,submissions,receipts,conversations,messages} from '@/src/application/operations/queries';
let f:Awaited<ReturnType<typeof scenario>>;let delivery:Awaited<ReturnType<Awaited<ReturnType<typeof scenario>>['delivery']>>;
beforeAll(async()=>{f=await scenario();delivery=await f.delivery();},120000);
afterAll(async()=>{if(f)await withOwner(c=>c.query('SELECT lumbung.demo_reset_begin($1)',[f.slug]));await closeOwnerPool();});
const call=<T>(fn:string,args:unknown[],user='ADMIN')=>f.sql<T>(fn,args,user);
describe('operational boundaries',()=>{
 it('loads every new read model against the actual schema',async()=>{
  const data=await f.tx(async c=>({batches:await batches(c),inbounds:await inbounds(c),refs:await references(c),obligations:await obligations(c),receipts:await receipts(c,delivery.delivery.id),conversations:await conversations(c)}));
  expect(data.batches.length).toBeGreaterThan(0);expect(data.refs.warehouses.length).toBeGreaterThan(0);expect(data.receipts[0].lines[0].accepted_qty).toBe('10.000');
  expect(await f.tx(c=>submissions(c,data.obligations[0].id))).toBeInstanceOf(Array);expect(await f.tx(c=>messages(c,data.conversations[0].id))).toBeInstanceOf(Array);
 });
 it('imports the same external receipt once, and flags a changed external revision',async()=>{
  const local=await f.tx(async c=>(await c.query<{received_at:string;flo_code:string;product_code:string;source_code:string;unit:string;quantity:string;local_receipt_id:string}>(`SELECT r.received_at::text,f.code flo_code,p.code product_code,s.code source_code,rl.unit,rl.accepted_qty::text quantity,r.id local_receipt_id FROM lumbung.flo_receipts r JOIN lumbung.receipt_lines rl ON rl.receipt_id=r.id JOIN lumbung.delivery_lines dl ON dl.id=rl.delivery_line_id JOIN lumbung.products p ON p.id=dl.product_id JOIN lumbung.deliveries d ON d.id=r.delivery_id JOIN lumbung.source_locations s ON s.id=d.source_location_id JOIN lumbung.flos f ON f.id=r.flo_id WHERE r.id=$1`,[delivery.delivery.receipt_id])).rows[0]);
  const row={...local,external_id:'external-receipt-one',route:'DIRECT',source_revision:'1'};let key=idem();const preview=await call<{id:string;errors:number}>('preview_import',['RECEIPTS',JSON.stringify([row]),'a'.repeat(64),key.key,key.hash]);expect(preview.errors).toBe(0);
  key=idem();expect(await call('commit_import',[preview.id,key.key,key.hash])).toMatchObject({created:1,skipped:0});
  key=idem();const again=await call<{id:string;errors:number}>('preview_import',['RECEIPTS',JSON.stringify([{...row,source_revision:'2'}]),'a'.repeat(64),key.key,key.hash]);expect(again.errors).toBe(0);key=idem();expect(await call('commit_import',[again.id,key.key,key.hash])).toMatchObject({created:0,skipped:1});
  const count=await f.tx(async c=>(await c.query<{n:number}>("SELECT count(*)::int n FROM lumbung.external_mappings WHERE external_id='external-receipt-one'")).rows[0].n);expect(count).toBe(1);
  key=idem();const changed=await call<{errors:number}>('preview_import',['RECEIPTS',JSON.stringify([{...row,quantity:'9'}]),'b'.repeat(64),key.key,key.hash]);expect(changed.errors).toBe(1);
 });
 it('creates a historical imported receipt without inventing warehouse movements',async()=>{
  const key=idem();const preview=await call<{id:string;errors:number}>('preview_import',['RECEIPTS',JSON.stringify([{external_id:'external-historical',flo_code:'FLO-0001',product_code:'ROTI-TAWAR',source_code:'SRC-001',route:'DIRECT',quantity:'9',unit:'portion',received_at:'2026-10-25T03:00:00Z'}]),'c'.repeat(64),key.key,key.hash]);expect(preview.errors).toBe(0);const k=idem();expect(await call('commit_import',[preview.id,k.key,k.hash])).toMatchObject({created:1});
 });
 it('enforces FLO link scope, expiry and per-purpose upload permissions',async()=>{
  const token=Buffer.from(randomUUID()+randomUUID()).toString('base64url');let k=idem();const link=await call<{id:string}>('create_flo_link',['DELIVERY',delivery.delivery.id,hashToken(token),1,k.key,k.hash],'KOORD1');
  const ctx={...f.ctx(),actorKind:'FLO_LINK' as const,userId:null,linkId:link.id};
  const view=await withAppTx(ctx,async c=>(await c.query('SELECT lumbung.flo_link_view() v')).rows[0].v);expect(view.delivery.id).toBe(delivery.delivery.id);expect(view).not.toHaveProperty('contacts');
  const media=randomUUID();k=idem();expect(await withAppTx(ctx,async c=>(await c.query('SELECT lumbung.register_media($1,$2,$3) v',[JSON.stringify({id:media,subject_id:delivery.delivery.id,purpose:'EVIDENCE',storage_key:`${f.ids.tenantId}/${media}`,sha256:'d'.repeat(64),mime:'image/png',bytes:100}),k.key,k.hash])).rows[0].v)).toMatchObject({id:media,duplicate:false});
  k=idem();await expect(withAppTx(ctx,c=>c.query('SELECT lumbung.register_media($1,$2,$3)',[JSON.stringify({id:randomUUID(),subject_id:f.ids.id('flo','FLO-0002'),purpose:'EVIDENCE'}),k.key,k.hash]))).rejects.toMatchObject({code:'NOT_FOUND'});
  k=idem();await f.sql('advance_direct_clock',[61,k.key,k.hash]);await expect(withAppTx(ctx,c=>c.query('SELECT lumbung.flo_link_view()'))).rejects.toBeDefined();
 });
 it('publishes a versioned H+1 policy without changing existing due times',async()=>{
  const old=await f.tx(async c=>(await c.query<{id:string;body:Record<string,unknown>}>("SELECT p.id,p.body FROM lumbung.policy_versions p JOIN lumbung.tenant_active_policies a ON a.policy_version_id=p.id WHERE p.kind='REPORTING'")).rows[0]);const before=await f.tx(async c=>(await c.query('SELECT id,due_at,policy_version_id FROM lumbung.evidence_obligations ORDER BY id')).rows);
  const k=idem();expect(await call('admin_command',['policy',old.id,JSON.stringify({body:{...old.body,due_rules:{BAST:'AT_RECEIPT',RECEIPT_PHOTO:'ROLLING_24H',DISTRIBUTION:'ROLLING_24H'}},reason:'Pilot policy alternative approved for simulation'}),k.key,k.hash])).toMatchObject({state:'APPROVED_DEMO'});
  expect(await f.tx(async c=>(await c.query('SELECT id,due_at,policy_version_id FROM lumbung.evidence_obligations ORDER BY id')).rows)).toEqual(before);
 });
});
it('corrects receipt history through independent approval and keeps one current fairness contribution',async()=>{
 const r=await f.tx(async c=>(await c.query<{id:string}>('SELECT id FROM lumbung.receipt_lines WHERE receipt_id=$1',[delivery.delivery.receipt_id])).rows[0]);let k=idem();
 const distribution=idem();await f.sql('reporting_command',['distribution',null,JSON.stringify({receipt_id:delivery.delivery.receipt_id,occurred_at:'2026-10-26T01:01:00Z',people_reported:4,lines:[{receipt_line_id:r.id,distributed_quantity:'4',loss_quantity:'0',reported_consumed_quantity:null}]}),distribution.key,distribution.hash]);
 const request=await call<{id:string}>('correct_receipt',['request',delivery.delivery.receipt_id,JSON.stringify({reason:'Corrected handover count after review',lines:[{receipt_line_id:r.id,accepted_quantity:'9',rejected_quantity:'1'}]}),k.key,k.hash],'KOORD1');k=idem();const approved=await call('correct_receipt',['approve',request.id,JSON.stringify({expected_revision:1,reason:'Independent review of the corrected receipt'}),k.key,k.hash],'GUDANG2');expect(approved).toMatchObject({state:'APPROVED'});
 const counts=await f.tx(async c=>(await c.query<{n:number;qty:string}>('SELECT count(*)::int n,sum(accepted_qty)::text qty FROM lumbung.receipt_lines WHERE delivery_line_id IN(SELECT id FROM lumbung.delivery_lines WHERE delivery_id=$1) AND is_current',[delivery.delivery.id])).rows[0]);expect(counts.n).toBe(1);expect(Number(counts.qty)).toBe(9);
 const token=Buffer.from(randomUUID()).toString('base64url');k=idem();const link=await call<{id:string}>('create_flo_link',['DELIVERY',delivery.delivery.id,hashToken(token),12,k.key,k.hash],'KOORD1');const view=await withAppTx({...f.ctx(),actorKind:'FLO_LINK',userId:null,linkId:link.id},async c=>(await c.query('SELECT lumbung.flo_link_view() v')).rows[0].v);expect(Number(view.receipts[0].lines[0].remaining_quantity)).toBe(5);
});
it('keeps auditors read-only when operational tasks can be resolved by staff',async()=>{
 const task=await f.tx(async c=>(await c.query<{id:string}>('SELECT id FROM lumbung.tasks ORDER BY id LIMIT 1')).rows[0]);const k=idem();await expect(f.sql('resolve_task',[task.id,'Auditors must not change operational records',k.key,k.hash],'AUDITOR')).rejects.toMatchObject({code:'FORBIDDEN'});
});
