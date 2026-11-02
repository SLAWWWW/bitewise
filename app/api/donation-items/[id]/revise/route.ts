import { handler } from '@/src/http/handler';
import { reviseBody } from '@/src/contracts/direct';
import { idParam } from '@/src/application/flo/route-helpers';
export const POST=handler({capability:'donation.validate',body:reviseBody,idempotent:true,route:'/api/donation-items/[id]/revise',notFoundOnForbidden:true},async ctx=>{
  const r=await ctx.tx(async c=>(await c.query<{r:{id:string;revision:number}}>('SELECT lumbung.revise_direct_item($1,$2,$3,$4) AS r',
    [idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].r);
  return ctx.ok(r,{revision:r.revision});
});
