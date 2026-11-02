import {z} from 'zod';
import {handler} from '@/src/http/handler';
const body=z.object({event_id:z.string().min(1).max(200),contact_id:z.uuid().nullable(),text:z.string().min(1).max(6000),offer_code:z.string().max(40).optional(),quantity:z.string().max(20).optional(),reason:z.string().max(100).optional()}).strict();
export const POST=handler({capability:'message.send',body,idempotent:true,route:'/api/demo/simulate-flo'},async ctx=>{
  const result=await ctx.tx(async c=>(await c.query('SELECT lumbung.ingest_mock_event($1,$2,$3) AS v',[JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v);
  return ctx.ok(result,{status:202});
});
