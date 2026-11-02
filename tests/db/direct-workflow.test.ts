import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { seedTenant } from '@/db/seed';
import { Ids } from '@/db/seed/config';
import type { DbCtx } from '@/src/db/types';
import { directCommand, runAllocation } from '@/src/application/direct/commands';
import { getDonation, listCampaigns, listDeliveries } from '@/src/application/direct/queries';
import { runDue } from '@/src/jobs/run-due';
import { revokeAgreement } from '@/src/application/agreements/commands';
import { closeOwnerPool, ownerPool, withAppTx, withOwner } from '../setup/db-helpers';

const slugs: string[]=[];
const idem=()=>({idempotencyKey:randomUUID(),requestHash:randomUUID()});
afterAll(async()=>{await withOwner(async c=>{for(const s of slugs)await c.query('SELECT lumbung.demo_reset_begin($1)',[s]);});await closeOwnerPool();},120000);

async function fixture(quantity='120') {
  const slug=`direct-${randomBytes(5).toString('hex')}`; slugs.push(slug);
  const seeded=await seedTenant(ownerPool(),{slug,mode:'TEST',expected:'skip'});const ids=new Ids(slug);
  const ctx:DbCtx={tenantId:seeded.tenantId,userId:ids.id('user','KOORD1'),actorKind:'USER',correlationId:randomUUID()};
  const exec=(action:string,id:string|null,body:unknown,key=idem())=>withAppTx(ctx,c=>directCommand(c,action,id,body,key));
  const stockBefore=await withAppTx(ctx,async c=>(await c.query<{n:number}>('SELECT count(*)::int AS n FROM lumbung.stock_movements')).rows[0].n);
  const refs=await withAppTx(ctx,async c=>(await c.query<{donor_id:string;source_location_id:string;product_id:string}>(`SELECT s.donor_id,s.id AS source_location_id,p.id AS product_id
    FROM lumbung.source_locations s CROSS JOIN lumbung.products p WHERE s.code='SRC-001' AND p.code='ROTI-TAWAR'`)).rows[0]);
  const order=await exec('create',null,{...refs,pickup_start:'2026-10-26T01:00:00Z',pickup_end:'2026-10-26T04:00:00Z',donation_reason:'SURPLUS',
    items:[{product_id:refs.product_id,quantity,unit:'portion',condition:'GOOD',prep_info:{ready_at:'2026-10-26T01:00:00Z'},label_info:{},distribute_by:'2026-10-26T07:00:00Z'}]});
  await exec('validate',order.id,{expected_revision:order.revision});
  const donation=await withAppTx(ctx,c=>getDonation(c,order.id));const item=donation!.items[0];
  const plan=await withAppTx(ctx,c=>runAllocation(c,{item_id:item.id,receipt_at:'2026-10-26T02:00:00Z',distribution_at:'2026-10-26T03:00:00Z'},idem()));
  const campaign=await exec('draft',plan.id,{});
  const campaigns=()=>withAppTx(ctx,c=>listCampaigns(c,order.id));
  async function start(){await exec('approve-outreach',campaign.id,{expected_revision:campaign.revision,reason:'Approved test scope'});await exec('start',campaign.id,{expected_revision:campaign.revision});await runDue(ctx);return (await campaigns())[0];}
  return {ctx,ids,exec,order,item,plan,campaign,campaigns,start,stockBefore,refs};
}

async function acceptAndApprove(f:Awaited<ReturnType<typeof fixture>>) {
  const c=await f.start();const offer=c.offers[0];
  await f.exec('respond',offer.id,{expected_revision:offer.revision,response:'ACCEPT',quantity:offer.quantity});
  const a=(await f.campaigns())[0].allocations.find(a=>a.flo_id===offer.flo_id)!;
  const transport=await f.exec('transport',a.id,{expected_revision:a.revision,method:'SELF_PICKUP',decision:'ACCEPT',arranger:'FLO confirms self collection',fee_idr:null,contact_id:a.contact_id});
  const approved=await f.exec('approve-dispatch',a.id,{expected_revision:transport.revision,reason:'Confirmed collection and quantities'});
  return {a,offer,approved};
}

describe('persistent direct donation vertical slice',()=>{
  it('SC01: excludes expired closest FLO, records both approvals, dispatches and receipts without warehouse stock',async()=>{
    const f=await fixture();
    expect(f.plan.result.excluded.find(c=>c.code==='FLO-0001')?.reasons).toContain('AGREEMENT_EXPIRED');
    expect(f.plan.result.selected.length).toBeGreaterThan(0);
    expect(f.plan.result.selected.length).toBeLessThanOrEqual(3);
    const scoped=await f.exec('draft',f.plan.id,{lines:[{flo_id:f.ids.id('flo','FLO-0003'),quantity:'60'},
      {flo_id:f.ids.id('flo','FLO-0004'),quantity:'40'}],reason:'SC01: two practical deliveries; retain twenty for the next approved wave'});
    await f.exec('approve-outreach',scoped.id,{expected_revision:1,reason:'SC01 reviewed outreach'});
    await f.exec('start',scoped.id,{expected_revision:1});await runDue(f.ctx);
    const c=(await f.campaigns()).find(c=>c.id===scoped.id)!;expect(c.offers).toHaveLength(2);
    const offer=c.offers.find(o=>o.flo_id===f.ids.id('flo','FLO-0003'))!;expect(offer.state).toBe('DELIVERED');expect(Number(offer.quantity)).toBe(60);
    await f.exec('respond',offer.id,{expected_revision:offer.revision,response:'ACCEPT',quantity:offer.quantity});
    const a=(await f.campaigns()).find(c=>c.id===scoped.id)!.allocations.find(a=>a.flo_id===offer.flo_id)!;
    const transport=await f.exec('transport',a.id,{expected_revision:a.revision,method:'SELF_PICKUP',decision:'ACCEPT',arranger:'FLO confirms self collection',fee_idr:null,contact_id:a.contact_id});
    const approved=await f.exec('approve-dispatch',a.id,{expected_revision:transport.revision,reason:'Confirmed collection and quantities'});
    const deliveryId=approved.delivery_id!;const key=idem();
    const dispatched=await f.exec('dispatch',deliveryId,{expected_revision:1,custodian:'FLO collection driver'},key);
    expect(await f.exec('dispatch',deliveryId,{expected_revision:1,custodian:'FLO collection driver'},key)).toEqual(dispatched);
    await expect(f.exec('dispatch',deliveryId,{expected_revision:1,custodian:'Different driver'},key)).rejects.toMatchObject({code:'IDEMPOTENCY_PAYLOAD_MISMATCH'});
    const receipt=await f.exec('receive',deliveryId,{expected_revision:dispatched.revision,accepted_quantity:offer.quantity,rejected_quantity:'0'});
    expect(receipt.state).toBe('RECEIVED');
    const d=(await withAppTx(f.ctx,c=>listDeliveries(c,deliveryId)))[0];
    expect(d.obligations.map(o=>o.type).sort()).toEqual(['BAST','RECEIPT_PHOTO']);
    expect(Date.parse(d.obligations.find(o=>o.type==='RECEIPT_PHOTO')!.due_at)).toBe(Date.parse('2026-10-27T16:59:59.999Z'));
    const quantities=await withAppTx(f.ctx,async c=>(await c.query<{stock:number;receipts:number;accepted:string}>(`SELECT
      (SELECT count(*)::int FROM lumbung.stock_movements) AS stock,
      (SELECT count(*)::int FROM lumbung.flo_receipts WHERE delivery_id=$2) AS receipts,
      (SELECT sum(accepted_qty)::text FROM lumbung.receipt_lines WHERE receipt_id=$3) AS accepted WHERE $1::int IS NOT NULL`,[1,deliveryId,receipt.receipt_id])).rows[0]);
    expect(quantities.stock).toBe(f.stockBefore);
    expect(quantities.receipts).toBe(1);expect(Number(quantities.accepted)).toBe(Number(offer.quantity));
    expect(await withAppTx(f.ctx,async c=>(await c.query('SELECT 1 FROM lumbung.inventory_batches WHERE donor_line_id=$1',[f.item.id])).rowCount)).toBe(0);
    const second=c.offers.find(o=>o.id!==offer.id)!;expect(Number(second.quantity)).toBe(40);
    await f.exec('respond',second.id,{expected_revision:second.revision,response:'ACCEPT',quantity:second.quantity});
    const a2=(await f.campaigns()).find(c=>c.id===scoped.id)!.allocations.find(a=>a.flo_id===second.flo_id)!;
    const t2=await f.exec('transport',a2.id,{expected_revision:a2.revision,method:'SELF_PICKUP',decision:'ACCEPT',arranger:'Second FLO self collection',fee_idr:null,contact_id:a2.contact_id});
    const ap2=await f.exec('approve-dispatch',a2.id,{expected_revision:t2.revision,reason:'Second reviewed delivery'});
    const d2=await f.exec('dispatch',ap2.delivery_id!,{expected_revision:1,custodian:'Second FLO driver'});
    await f.exec('receive',d2.id,{expected_revision:d2.revision,accepted_quantity:second.quantity,rejected_quantity:'0'});
    const order=await withAppTx(f.ctx,c=>getDonation(c,f.order.id));expect(Number(order!.items[0].available_quantity)).toBe(20);
    const invariants=await ownerPool().query('SELECT * FROM lumbung.verify_tenant_invariants($1)',[f.ctx.tenantId]);expect(invariants.rows).toEqual([]);
  });

  it('enforces outreach approval and capabilities at the SQL boundary',async()=>{
    const f=await fixture('10');
    await expect(f.exec('start',f.campaign.id,{expected_revision:1})).rejects.toMatchObject({code:'OUTREACH_APPROVAL_REQUIRED'});
    await expect(withAppTx({...f.ctx,userId:f.ids.id('user','AUDITOR')},c=>directCommand(c,'approve-outreach',f.campaign.id,{expected_revision:1,reason:'Attempted bypass'},idem())))
      .rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(withAppTx({...f.ctx,userId:null,actorKind:'AGENT'},c=>directCommand(c,'approve-outreach',f.campaign.id,{expected_revision:1,reason:'Agent attempt'},idem())))
      .rejects.toMatchObject({code:'FORBIDDEN'});
    expect((await f.campaigns())[0].offers).toHaveLength(0);
  });

  it('partial acceptance resizes the existing hold once and releases the remainder',async()=>{
    const f=await fixture('60');const c=await f.start();const o=c.offers[0];const qty=String(Number(o.quantity)-1);const key=idem();
    const response={expected_revision:o.revision,response:'PARTIAL_ACCEPT',quantity:qty};
    await f.exec('respond',o.id,response,key);await f.exec('respond',o.id,response,key);
    const rows=await withAppTx(f.ctx,async c=>(await c.query<{quantity:string;kind:string;n:number}>(`SELECT rl.quantity::text,r.kind,count(*) OVER()::int AS n
      FROM lumbung.reservations r JOIN lumbung.reservation_lines rl ON rl.reservation_id=r.id WHERE r.offer_id=$1 AND r.state='ACTIVE'`,[o.id])).rows);
    expect(rows).toHaveLength(1);expect(Number(rows[0].quantity)).toBe(Number(qty));expect(rows[0].kind).toBe('RESERVATION');
    await expect(f.exec('respond',o.id,{...response,quantity:'999'},key)).rejects.toMatchObject({code:'IDEMPOTENCY_PAYLOAD_MISMATCH'});
  });

  it('SC03: competing campaigns cannot hold the same last ten units',async()=>{
    const f=await fixture('10');const second=await f.exec('draft',f.plan.id,{});
    for(const id of [f.campaign.id,second.id])await f.exec('approve-outreach',id,{expected_revision:1,reason:'Approved competing scope'});
    const results=await Promise.allSettled([f.exec('start',f.campaign.id,{expected_revision:1}),f.exec('start',second.id,{expected_revision:1})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.code)).toEqual(['STOCK_UNAVAILABLE']);
    const total=await withAppTx(f.ctx,async c=>(await c.query<{q:string}>('SELECT sum(quantity)::text AS q FROM lumbung.allocations WHERE item_id=$1',[f.item.id])).rows[0].q);
    expect(Number(total)).toBe(10);
  });

  it('expiry releases once, survives a fresh runner and rejects late acceptance',async()=>{
    const f=await fixture('10');const c=await f.start();const o=c.offers[0];
    const pending=await withAppTx(f.ctx,client=>client.query<{r_eligible:boolean|null}>('SELECT r_eligible FROM lumbung.offers WHERE id=$1',[o.id]));
    expect(pending.rows[0].r_eligible).toBeNull();
    await withAppTx(f.ctx,c=>c.query('SELECT lumbung.advance_direct_clock(16,$1,$2)',[randomUUID(),randomUUID()]));
    await expect(f.exec('respond',o.id,{expected_revision:o.revision,response:'ACCEPT',quantity:o.quantity})).rejects.toMatchObject({code:'OFFER_EXPIRED'});
    await runDue(f.ctx,'replacement-worker');const again=await runDue(f.ctx,'replacement-worker-2');
    expect(again.expired).toBe(0);expect((await f.campaigns())[0].allocations[0].state).toBe('EXPIRED');
    const active=await withAppTx(f.ctx,client=>client.query('SELECT 1 FROM lumbung.reservations WHERE allocation_id=$1 AND state=\'ACTIVE\'',[c.allocations[0].id]));
    expect(active.rowCount).toBe(0);
    const opportunity=await withAppTx(f.ctx,client=>client.query<{r_eligible:boolean;r_timely:boolean}>('SELECT r_eligible,r_timely FROM lumbung.offers WHERE id=$1',[o.id]));
    expect(opportunity.rows[0]).toEqual({r_eligible:true,r_timely:false});
  });

  it('SC02: unaffordable ongkir creates logistics review without changing reliability',async()=>{
    const f=await fixture('10');const c=await f.start();const o=c.offers[0];
    await f.exec('respond',o.id,{expected_revision:o.revision,response:'ACCEPT',quantity:o.quantity});
    const a=(await f.campaigns())[0].allocations[0];
    const before=await withAppTx(f.ctx,c=>c.query('SELECT r_eligible,r_timely FROM lumbung.offers WHERE id=$1',[o.id]));
    const refused=await f.exec('transport',a.id,{expected_revision:a.revision,method:'FLO_BOOKED_COURIER',decision:'REFUSE',arranger:'Courier quote declined by FLO',fee_idr:50000,contact_id:a.contact_id});
    expect(refused.state).toBe('CANCELLED');
    await expect(f.exec('approve-dispatch',a.id,{expected_revision:refused.revision,reason:'Cannot bypass fee refusal'})).rejects.toMatchObject({code:'INVALID_STATE'});
    expect((await withAppTx(f.ctx,c=>c.query('SELECT r_eligible,r_timely FROM lumbung.offers WHERE id=$1',[o.id]))).rows).toEqual(before.rows);
    expect((await withAppTx(f.ctx,c=>c.query('SELECT 1 FROM lumbung.tasks WHERE subject_id=$1 AND kind=\'LOGISTICS_REVIEW\'',[a.id]))).rowCount).toBe(1);
  });

  it('changed transport invalidates final approval and blocks pickup until a fresh approval',async()=>{
    const f=await fixture('10');const {a,approved}=await acceptAndApprove(f);
    const changed=await f.exec('transport',a.id,{expected_revision:approved.revision,method:'FLO_BOOKED_COURIER',decision:'ACCEPT',arranger:'Changed courier and fee confirmed by FLO',fee_idr:20000,contact_id:a.contact_id});
    await expect(f.exec('dispatch',approved.delivery_id!,{expected_revision:1,custodian:'Courier driver'})).rejects.toMatchObject({code:'DISPATCH_APPROVAL_REQUIRED'});
    expect(changed.state).toBe('AWAITING_FINAL_APPROVAL');
    const fresh=await f.exec('approve-dispatch',a.id,{expected_revision:changed.revision,reason:'Review changed fee and arrangement'});
    expect(fresh.delivery_id).toBe(approved.delivery_id);
    expect((await f.exec('dispatch',fresh.delivery_id!,{expected_revision:1,custodian:'Courier driver'})).state).toBe('IN_TRANSIT');
  });

  it('SC06: revocation invalidates commitments and final approval; dispatch is blocked',async()=>{
    const f=await fixture('10');const {a,approved}=await acceptAndApprove(f);
    const agreement=await withAppTx(f.ctx,async c=>(await c.query<{id:string;revision:number}>('SELECT id,revision FROM lumbung.agreements WHERE flo_id=$1 AND review_state=\'APPROVED\' ORDER BY valid_from DESC LIMIT 1',[a.flo_id])).rows[0]);
    const result=await withAppTx({...f.ctx,userId:f.ids.id('user','REVIEW_AGR')},c=>revokeAgreement(c,agreement.id,{expected_revision:agreement.revision,reason:'Synthetic incident before pickup'},idem()));
    expect(result.commitments.affected_allocations).toBeGreaterThan(0);
    await expect(f.exec('dispatch',approved.delivery_id!,{expected_revision:1,custodian:'FLO collection driver'})).rejects.toMatchObject({code:'DISPATCH_APPROVAL_REQUIRED'});
    expect((await f.campaigns())[0].allocations[0].state).toBe('EXCEPTION');
    expect((await withAppTx(f.ctx,c=>c.query('SELECT 1 FROM lumbung.tasks WHERE subject_id=$1 AND kind=\'AGREEMENT_REVOKED_ACTIVE_COMMITMENT\'',[a.id]))).rowCount).toBe(1);
  });

  it('unknown provider outcome is visible and never blindly resent',async()=>{
    const f=await fixture('10');
    await withOwner(c=>c.query('UPDATE lumbung.simulation_settings SET send_fault=\'DELIVERY_UNKNOWN\' WHERE tenant_id=$1',[f.ctx.tenantId]));
    const c=await f.start();expect(c.offers[0].state).toBe('DELIVERY_UNKNOWN');
    const next=await runDue(f.ctx,'replacement');expect(next.sent).toBe(0);
    const b=await withAppTx(f.ctx,client=>client.query<{attempts:number}>('SELECT attempts FROM lumbung.outbox WHERE payload->>\'offer_id\'=$1',[c.offers[0].id]));
    expect(b.rows[0].attempts).toBe(1);
  });

  it('receipt discrepancy counts only actual accepted food, once',async()=>{
    const f=await fixture('10');const {offer,approved}=await acceptAndApprove(f);
    const d=await f.exec('dispatch',approved.delivery_id!,{expected_revision:1,custodian:'FLO collection driver'});
    await expect(f.exec('receive',d.id,{expected_revision:d.revision,accepted_quantity:'11',rejected_quantity:'0'})).rejects.toMatchObject({code:'RECEIPT_EXCEEDS_DISPATCHED'});
    const key=idem();const body={expected_revision:d.revision,accepted_quantity:'7',rejected_quantity:'2',reason:'Two damaged; one unaccounted for'};
    const received=await f.exec('receive',d.id,body,key);await f.exec('receive',d.id,body,key);expect(received.state).toBe('PARTIALLY_RECEIVED');
    const line=await withAppTx(f.ctx,c=>c.query<{q:string;n:number}>('SELECT sum(accepted_qty)::text AS q,count(*)::int AS n FROM lumbung.receipt_lines WHERE receipt_id=$1',[received.receipt_id]));
    expect(Number(line.rows[0].q)).toBe(7);expect(line.rows[0].n).toBe(1);
    const snapshot=await withAppTx(f.ctx,async c=>(await c.query<{s:{candidates:{id:string;committed:string}[]}}>('SELECT lumbung.direct_features($1,$2,$3) AS s',[f.item.id,'2026-10-26T02:00:00Z','2026-10-26T03:00:00Z'])).rows[0].s);
    expect(Number(snapshot.candidates.find(c=>c.id===offer.flo_id)!.committed)).toBe(0);
  });

  it('locks FLO capacity across competing donations from different source items',async()=>{
    const f=await fixture('40');const o2=await f.exec('create',null,{...f.refs,pickup_start:'2026-10-26T01:00:00Z',pickup_end:'2026-10-26T04:00:00Z',donation_reason:'SURPLUS',
      items:[{product_id:f.refs.product_id,quantity:'40',unit:'portion',condition:'GOOD',prep_info:{ready_at:'2026-10-26T01:00:00Z'},distribute_by:'2026-10-26T07:00:00Z'}]});
    await f.exec('validate',o2.id,{expected_revision:1});
    const item2=(await withAppTx(f.ctx,c=>getDonation(c,o2.id)))!.items[0];
    const run2=await withAppTx(f.ctx,c=>runAllocation(c,{item_id:item2.id,receipt_at:'2026-10-26T02:00:00Z',distribution_at:'2026-10-26T03:00:00Z'},idem()));
    expect(run2.result.selected[0].flo_id).toBe(f.plan.result.selected[0].flo_id);
    const campaign2=await f.exec('draft',run2.id,{});
    for(const id of [f.campaign.id,campaign2.id])await f.exec('approve-outreach',id,{expected_revision:1,reason:'Capacity race scope reviewed'});
    const results=await Promise.allSettled([f.exec('start',f.campaign.id,{expected_revision:1}),f.exec('start',campaign2.id,{expected_revision:1})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.code)).toEqual(['CAPACITY_EXCEEDED']);
  });

  it('recovers a crashed send lease as unknown, never as a fresh send',async()=>{
    const f=await fixture('10');await f.exec('approve-outreach',f.campaign.id,{expected_revision:1,reason:'Reviewed scope'});await f.exec('start',f.campaign.id,{expected_revision:1});
    const claimed=await withAppTx(f.ctx,async c=>(await c.query<{b:{id:string}}>('SELECT lumbung.claim_direct_outbox($1,30) AS b',['crashed-worker'])).rows[0].b);
    await withOwner(c=>c.query('UPDATE lumbung.outbox SET lease_expires_at=clock_timestamp()-interval \'1 second\' WHERE id=$1',[claimed.id]));
    // Reporting messages for other seeded deliveries may also be due. The offer
    // below must stay unknown with exactly one provider attempt.
    await runDue(f.ctx,'new-worker');
    const row=await withAppTx(f.ctx,async c=>(await c.query<{state:string;attempts:number}>('SELECT state,attempts FROM lumbung.outbox WHERE id=$1',[claimed.id])).rows[0]);
    expect(row).toEqual({state:'DELIVERY_UNKNOWN',attempts:1});
    expect((await withAppTx(f.ctx,c=>c.query('SELECT 1 FROM lumbung.tasks WHERE subject_id=$1 AND kind=\'SEND_RECONCILE\'',[claimed.id]))).rowCount).toBe(1);
  });
});
