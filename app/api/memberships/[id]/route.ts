import {handler} from '@/src/http/handler';
import {memberBody} from '@/src/contracts/operations';
import {idParam} from '@/src/application/flo/route-helpers';
export const POST=handler({capability:'users.manage',body:memberBody,idempotent:true,route:'/api/memberships/[id]',notFoundOnForbidden:true},async ctx=>ctx.ok(await ctx.tx(async c=>(await c.query(`SELECT lumbung.admin_command('member',$1,$2,$3,$4) AS v`,[idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v)));
