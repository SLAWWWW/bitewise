import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {handler} from '@/src/http/handler';
import {DomainError} from '@/src/db/errors';
import {getEnv} from '@/src/config/env';
import {withTx} from '@/src/db/tx';
import {sha256Hex} from '@/src/lib/hash';
const schema=z.object({tenant_id:z.uuid(),event_id:z.string().min(1).max(200),contact_id:z.uuid().nullable(),text:z.string().min(1).max(6000),offer_code:z.string().optional(),quantity:z.string().optional(),reason:z.string().optional()}).strict();
export const POST=handler({auth:'none',route:'/api/webhooks/mock'},async ctx=>{
  if(getEnv().APP_MODE==='LIVE')throw new DomainError({code:'LIVE_SEND_BLOCKED'});
  const text=await ctx.request.text();if(text.length>16000)throw new DomainError({code:'BAD_REQUEST'});
  const signature=ctx.request.headers.get('x-mock-signature')??'';const expected=createHmac('sha256',getEnv().SESSION_SECRET).update(text).digest('hex');
  if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new DomainError({code:'FORBIDDEN'});
  let json:unknown;try{json=JSON.parse(text);}catch{throw new DomainError({code:'BAD_REQUEST'});}
  const parsed=schema.safeParse(json);if(!parsed.success)throw new DomainError({code:'BAD_REQUEST'});
  const {tenant_id,...event}=parsed.data;
  const result=await withTx({tenantId:tenant_id,userId:null,actorKind:'WORKER',correlationId:ctx.correlationId},async c=>(await c.query('SELECT lumbung.ingest_mock_event($1,$2,$3) AS v',[JSON.stringify(event),`webhook:${event.event_id}`,sha256Hex(text)])).rows[0].v);
  return ctx.ok(result,{status:202});
});
