import {z} from 'zod';
import {handler} from '@/src/http/handler';
import {idParam} from '@/src/application/flo/route-helpers';
import {qtyString,positiveQtyString} from '@/src/lib/qty';
const body=z.object({expected_revision:z.number().int().positive(),category_id:z.uuid(),unit:z.string().min(1),capacity:qtyString,demand:positiveQtyString,people:z.number().int().positive(),count_basis:z.enum(['DAILY_RESIDENTS','PER_EVENT','WEEKLY_REACH']),basis:z.enum(['PER_EVENT_QTY','PER_PERSON_QTY']),service_dows:z.array(z.number().int().min(1).max(7)).min(1),start_local:z.string().regex(/^\d\d:\d\d$/),end_local:z.string().regex(/^\d\d:\d\d$/),contact_id:z.uuid().optional(),consent_state:z.enum(['GRANTED','WITHDRAWN','UNKNOWN']).optional(),reason:z.string().min(3).max(3000)}).strict();
export const POST=handler({capability:'need.confirm',body,idempotent:true,route:'/api/flos/[id]/operations'},async ctx=>ctx.ok(await ctx.tx(async c=>(await c.query('SELECT lumbung.configure_flo($1,$2,$3,$4) AS v',[idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v)));
