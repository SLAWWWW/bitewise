import { handler } from '@/src/http/handler';
import { campaignBody } from '@/src/contracts/direct';
import { directCommand } from '@/src/application/direct/commands';
export const POST = handler({ capability: 'allocation.run', body: campaignBody, idempotent: true, route: '/api/campaigns' }, async ctx =>
  ctx.ok(await ctx.tx(c => directCommand(c, 'draft', ctx.body.run_id, ctx.body, { idempotencyKey: ctx.idempotencyKey!, requestHash: ctx.requestHash! })), { status: 201 }));
