import {randomBytes,randomUUID} from 'node:crypto';
import {seedTenant} from '@/db/seed';
import {Ids} from '@/db/seed/config';
import type {DbCtx,Queryable} from '@/src/db/types';
import {ownerPool,withAppTx} from './db-helpers';
import {directCommand,runAllocation} from '@/src/application/direct/commands';
import {getDonation,listCampaigns} from '@/src/application/direct/queries';
import {runDue} from '@/src/jobs/run-due';
export const idem=()=>({key:randomUUID(),hash:randomUUID()});
export async function scenario(){
 const slug=`scenario-${randomBytes(5).toString('hex')}`;const ids=new Ids(slug);await seedTenant(ownerPool(),{slug,mode:'TEST',expected:'skip'});
 const ctx=(user='KOORD1'):DbCtx=>({tenantId:ids.tenantId,userId:ids.id('user',user),actorKind:'USER',correlationId:randomUUID()});
 const tx=<T>(fn:(c:Queryable)=>Promise<T>,user='KOORD1')=>withAppTx(ctx(user),fn);
 const command=(action:string,id:string|null,p:unknown,user='KOORD1',intent=idem())=>tx(c=>directCommand(c,action,id,p,{idempotencyKey:intent.key,requestHash:intent.hash}),user);
 const sql=async<T>(fn:string,args:unknown[],user='KOORD1')=>tx(async c=>(await c.query<{v:T}>(`SELECT lumbung.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) AS v`,args)).rows[0].v,user);
 const refs=await tx(async c=>(await c.query<{donor_id:string;source_location_id:string;product_id:string}>(`SELECT s.donor_id,s.id source_location_id,p.id product_id FROM lumbung.source_locations s JOIN lumbung.products p ON p.tenant_id=s.tenant_id WHERE s.code='SRC-001' AND p.code='ROTI-TAWAR'`)).rows[0]);
 async function delivery(){
   const order=await command('create',null,{...refs,pickup_start:'2026-10-26T01:00:00Z',pickup_end:'2026-10-26T04:00:00Z',donation_reason:'SURPLUS',items:[{product_id:refs.product_id,quantity:'10',unit:'portion',condition:'GOOD',prep_info:{ready_at:'2026-10-26T01:00:00Z'},distribute_by:'2026-10-26T07:00:00Z'}]});
   await command('validate',order.id,{expected_revision:1});const item=(await tx(c=>getDonation(c,order.id)))!.items[0];const intent=idem();
   const run=await tx(c=>runAllocation(c,{item_id:item.id,receipt_at:'2026-10-26T02:00:00Z',distribution_at:'2026-10-26T03:00:00Z'},{idempotencyKey:intent.key,requestHash:intent.hash}));
   const campaign=await command('draft',run.id,{});await command('approve-outreach',campaign.id,{expected_revision:1,reason:'Reviewed scenario'});await command('start',campaign.id,{expected_revision:1});await runDue(ctx());
   const current=(await tx(c=>listCampaigns(c,order.id)))[0];const offer=current.offers[0];await command('respond',offer.id,{expected_revision:offer.revision,response:'ACCEPT',quantity:offer.quantity});
   const a=(await tx(c=>listCampaigns(c,order.id)))[0].allocations[0];const tr=await command('transport',a.id,{expected_revision:a.revision,method:'SELF_PICKUP',decision:'ACCEPT',arranger:'Confirmed by FLO',fee_idr:null,contact_id:a.contact_id});
   const approval=await command('approve-dispatch',a.id,{expected_revision:tr.revision,reason:'Confirmed scenario'});const dispatch=await command('dispatch',approval.delivery_id!,{expected_revision:1,custodian:'FLO scenario driver'});
   const received=await command('receive',dispatch.id,{expected_revision:dispatch.revision,accepted_quantity:'10',rejected_quantity:'0',inspection:{smell:'PASS',appearance:'PASS',texture:'PASS',packaging:'PASS',taste:'NOT_PERFORMED'}});
   return {order,item,offer,allocation:a,delivery:received};
 }
 return {slug,ids,ctx,tx,command,sql,refs,delivery};
}
