import {handler} from '@/src/http/handler';
import {reasonBody} from '@/src/contracts/operations';
import {idParam} from '@/src/application/flo/route-helpers';
export const POST=handler({capability:'audit.read',body:reasonBody,idempotent:true,route:'/api/tasks/[id]/resolve',notFoundOnForbidden:true},async ctx=>ctx.ok(await ctx.tx(async c=>(await c.query(`SELECT lumbung.resolve_task($1,$2->>'reason',$3,$4) AS v`,[idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v)));
