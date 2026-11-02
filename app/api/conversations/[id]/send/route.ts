import {handler} from '@/src/http/handler';
import {conversationBody} from '@/src/contracts/reporting';
import {idParam} from '@/src/application/flo/route-helpers';
export const POST=handler({capability:'message.send',body:conversationBody,idempotent:true,route:'/api/conversations/[id]/send',notFoundOnForbidden:true},async ctx=>ctx.ok(await ctx.tx(async c=>(await c.query('SELECT lumbung.conversation_command($1,$2,$3,$4,$5) AS v',['send',idParam(ctx.params),JSON.stringify(ctx.body),ctx.idempotencyKey,ctx.requestHash])).rows[0].v)));
