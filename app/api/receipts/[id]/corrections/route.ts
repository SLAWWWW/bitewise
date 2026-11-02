import {handler} from '@/src/http/handler';
import {correctionBody} from '@/src/contracts/operations';
import {idParam} from '@/src/application/flo/route-helpers';
export const POST=handler({capability:'receipt.correct',body:correctionBody,idempotent:true,route:'/api/receipts/[id]/corrections',notFoundOnForbidden:true},async ctx=>ctx.ok(await ctx.tx(async c=>(await c.query(`SELECT lumbung.correct_receipt('request',$1,$2,$3,$4) AS v`,[idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v)));
