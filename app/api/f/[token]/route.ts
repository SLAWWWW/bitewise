import {z} from 'zod';
import {handler} from '@/src/http/handler';
import {resolveLink,linkCtx} from '@/src/application/reporting/access';
import {withTx} from '@/src/db/tx';
import {responseBody,transportBody,receiptBody} from '@/src/contracts/direct';
const body=z.discriminatedUnion('action',[
  z.object({action:z.literal('respond'),offer_id:z.uuid(),payload:responseBody}),
  z.object({action:z.literal('transport'),payload:transportBody}),z.object({action:z.literal('receive'),payload:receiptBody})
]);
export const GET=handler({auth:'none',route:'/api/f/[token]',notFoundOnForbidden:true},async ctx=>{
  const link=await resolveLink(String(ctx.params.token));
  return ctx.ok(await withTx(linkCtx(link,ctx.correlationId),async c=>(await c.query('SELECT lumbung.flo_link_view() AS v')).rows[0].v));
});
export const POST=handler({auth:'none',body,idempotent:true,route:'/api/f/[token]',notFoundOnForbidden:true},async ctx=>{
  const link=await resolveLink(String(ctx.params.token));
  const payload=ctx.body.action==='respond'?{...ctx.body.payload,offer_id:ctx.body.offer_id}:ctx.body.payload;
  return ctx.ok(await withTx(linkCtx(link,ctx.correlationId),async c=>(await c.query('SELECT lumbung.flo_command($1,$2,$3,$4) AS v',[ctx.body.action,JSON.stringify(payload),ctx.idempotencyKey,ctx.requestHash])).rows[0].v));
});
