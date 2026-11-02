import {handler} from '@/src/http/handler';
import {pickBody} from '@/src/contracts/inventory';
import {idParam} from '@/src/application/flo/route-helpers';
export const POST=handler({capability:'inventory.pick',body:pickBody,idempotent:true,route:'/api/deliveries/[id]/pick',notFoundOnForbidden:true},async ctx=>ctx.ok(await ctx.tx(async c=>(await c.query('SELECT lumbung.pick_delivery($1,$2,$3,$4) AS v',[idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v)));
