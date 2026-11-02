import { randomBytes,randomUUID } from 'node:crypto';
import { afterAll,beforeAll,expect,it } from 'vitest';
import { seedTenant } from '@/db/seed';
import { Ids } from '@/db/seed/config';
import { signSession } from '@/src/security/session';
import { getEnv } from '@/src/config/env';
import { ownerPool,withOwner,closeOwnerPool,makeTenant } from '../setup/db-helpers';
import { GET,POST } from '@/app/api/donations/route';
import { GET as detail } from '@/app/api/donations/[id]/route';
import { POST as validate } from '@/app/api/donations/[id]/validate/route';
import { POST as allocate } from '@/app/api/allocation-runs/route';
import { POST as campaign } from '@/app/api/campaigns/route';
import { POST as start } from '@/app/api/campaigns/[id]/start/route';
import { POST as approve } from '@/app/api/campaigns/[id]/approve/route';

const slug=`direct-api-${randomBytes(4).toString('hex')}`;const ids=new Ids(slug);
let payload:Record<string,unknown>;
beforeAll(async()=>{
  await seedTenant(ownerPool(),{slug,mode:'TEST',expected:'skip'});
  const refs=(await ownerPool().query<{donor_id:string;source_location_id:string;product_id:string}>(`SELECT s.donor_id,s.id AS source_location_id,p.id AS product_id FROM lumbung.source_locations s
    JOIN lumbung.products p ON p.tenant_id=s.tenant_id AND p.code='ROTI-TAWAR' WHERE s.tenant_id=$1 AND s.code='SRC-001'`,[ids.tenantId])).rows[0];
  payload={donor_id:refs.donor_id,source_location_id:refs.source_location_id,pickup_start:'2026-10-26T01:00:00Z',pickup_end:'2026-10-26T04:00:00Z',donation_reason:'SURPLUS',
    items:[{product_id:refs.product_id,quantity:'10',unit:'portion',condition:'GOOD',prep_info:{ready_at:'2026-10-26T01:00:00Z'},distribute_by:'2026-10-26T07:00:00Z'}]};
});
afterAll(async()=>{await withOwner(c=>c.query('SELECT lumbung.demo_reset_begin($1)',[slug]));await closeOwnerPool();});
function req(path:string,body?:unknown,key:string|null=randomUUID(),role:string|null='KOORD1'){
  const headers=new Headers();if(role)headers.set('cookie',`lb_session=${signSession({uid:ids.id('user',role),tid:ids.tenantId},{secret:getEnv().SESSION_SECRET,now:new Date()})}`);
  if(key)headers.set('Idempotency-Key',key);if(body!==undefined)headers.set('content-type','application/json');
  return new Request(`http://localhost${path}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
}
const params=(id:string)=>({params:Promise.resolve({id})});
it('denies unsigned reads and unauthorized intake, and requires command keys',async()=>{
  expect((await GET(req('/api/donations',undefined,null,null))).status).toBe(401);
  expect((await POST(req('/api/donations',payload,randomUUID(),'AUDITOR'))).status).toBe(403);
  expect((await POST(req('/api/donations',payload,null))).status).toBe(400);
});
it('persists the API workflow, rejects stale revisions and enforces stage one',async()=>{
  const key=randomUUID();const first=await POST(req('/api/donations',payload,key));expect(first.status).toBe(201);const created=(await first.json()).data;
  expect((await (await POST(req('/api/donations',payload,key))).json()).data).toEqual(created);
  expect((await validate(req('/api/donations/id/validate',{expected_revision:999}),params(created.id))).status).toBe(409);
  expect((await validate(req('/api/donations/id/validate',{expected_revision:1}),params(created.id))).status).toBe(200);
  const donation=(await (await detail(req('/api/donations/id'),params(created.id))).json()).data;
  const planResponse=await allocate(req('/api/allocation-runs',{item_id:donation.items[0].id,receipt_at:'2026-10-26T02:00:00Z',distribution_at:'2026-10-26T03:00:00Z'}));
  expect(planResponse.status).toBe(201);const plan=(await planResponse.json()).data;
  const draft=await campaign(req('/api/campaigns',{run_id:plan.id}));expect(draft.status).toBe(201);const c=(await draft.json()).data;
  const blocked=await start(req('/api/campaigns/id/start',{expected_revision:1}),params(c.id));expect(blocked.status).toBe(422);expect((await blocked.json()).error.code).toBe('OUTREACH_APPROVAL_REQUIRED');
  expect((await approve(req('/api/campaigns/id/approve',{expected_revision:1,reason:'Reviewed scope'}),params(c.id))).status).toBe(200);
  expect((await start(req('/api/campaigns/id/start',{expected_revision:1}),params(c.id))).status).toBe(200);
});
it('foreign objects remain inaccessible even in a tenant without configured policies',async()=>{
  const other=await makeTenant(ownerPool(),{mode:'TEST'});
  try{
    const request=req('/api/donations/id/validate',{expected_revision:1});
    request.headers.set('cookie',`lb_session=${signSession({uid:other.users.COORDINATOR.id,tid:other.id},{secret:getEnv().SESSION_SECRET,now:new Date()})}`);
    const foreignId=(await ownerPool().query<{id:string}>('SELECT id FROM lumbung.donation_orders WHERE tenant_id=$1 LIMIT 1',[ids.tenantId])).rows[0].id;
    const response=await validate(request,params(foreignId));expect(response.status).toBe(404);expect((await response.json()).error.code).toBe('NOT_FOUND');
  }finally{await withOwner(c=>c.query('SELECT lumbung.demo_reset_begin($1)',[other.slug]));}
});
