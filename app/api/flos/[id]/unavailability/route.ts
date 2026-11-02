import {z} from 'zod';
import {handler} from '@/src/http/handler';
import {idParam} from '@/src/application/flo/route-helpers';
const body=z.object({expected_revision:z.number().int().positive(),starts_at:z.iso.datetime({offset:true}),ends_at:z.iso.datetime({offset:true}),reason:z.string().min(3).max(3000)}).strict();
export const POST=handler({capability:'flo.edit',body,idempotent:true,route:'/api/flos/[id]/unavailability'},async ctx=>ctx.ok(await ctx.tx(async c=>(await c.query('SELECT lumbung.record_unavailability($1,$2,$3,$4) AS v',[idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v)));
