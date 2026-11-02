import {handler} from '@/src/http/handler';
import {releaseBody} from '@/src/contracts/inventory';
import {planRelease} from '@/src/application/inventory/commands';
export const POST=handler({capability:'allocation.run',body:releaseBody,idempotent:true,route:'/api/inventory/release-plans'},async ctx=>
 ctx.ok(await ctx.tx(c=>planRelease(c,ctx.body,{idempotencyKey:ctx.idempotencyKey!,requestHash:ctx.requestHash!})),{status:201}));
