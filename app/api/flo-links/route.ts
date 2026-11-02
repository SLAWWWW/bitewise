import {handler} from '@/src/http/handler';
import {linkBody} from '@/src/contracts/reporting';
import {createHmac} from 'node:crypto';
import {hashToken} from '@/src/security/flo-link';
import {getEnv} from '@/src/config/env';
export const POST=handler({capability:'message.send',body:linkBody,idempotent:true,route:'/api/flo-links'},async ctx=>{
  const token=createHmac('sha256',getEnv().SESSION_SECRET).update(['flo-link-v1',ctx.actor.tenantId,ctx.actor.userId,ctx.body.subject_id,ctx.idempotencyKey].join('|')).digest('base64url');
  const result=await ctx.tx(async c=>(await c.query<{v:{id:string;expires_at:string}}>('SELECT lumbung.create_flo_link($1,$2,$3,$4,$5,$6) AS v',
    [ctx.body.subject_type,ctx.body.subject_id,hashToken(token),ctx.body.hours,ctx.idempotencyKey,ctx.requestHash])).rows[0].v);
  return ctx.ok({...result,path:`/f/${token}`});
});
