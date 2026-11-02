import {handler} from '@/src/http/handler';
import {idParam} from '@/src/application/flo/route-helpers';
export const POST=handler({capability:'import.commit',idempotent:true,route:'/api/imports/[id]/commit'},async ctx=>ctx.ok(await ctx.tx(async c=>(await c.query('SELECT lumbung.commit_import($1,$2,$3) AS v',[idParam(ctx.params),ctx.idempotencyKey,ctx.requestHash])).rows[0].v)));
