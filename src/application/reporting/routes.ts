import 'server-only';
import type {z} from 'zod';
import {handler} from '@/src/http/handler';
import {idParam} from '@/src/application/flo/route-helpers';
import {requestAccess} from './access';
import {withTx} from '@/src/db/tx';
export function reportingRoute(action:string,body:z.ZodType,route:string){
  return handler({auth:'none',body,idempotent:true,route,notFoundOnForbidden:true},async ctx=>{
    const access=await requestAccess(ctx.request,ctx.correlationId);
    const r=await withTx(access.ctx,async c=>(await c.query<{v:{id:string;revision:number}}>('SELECT lumbung.reporting_command($1,$2,$3,$4,$5) AS v',
      [action,action==='distribution'?null:idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v);
    return ctx.ok(r,{revision:r.revision});
  });
}
