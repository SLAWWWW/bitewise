import { handler } from '@/src/http/handler';
import { planBody } from '@/src/contracts/direct';
import { runAllocation } from '@/src/application/direct/commands';
export const POST = handler({ capability: 'allocation.run', body: planBody, idempotent: true, route: '/api/allocation-runs' }, async ctx =>
  ctx.ok(await ctx.tx(c => runAllocation(c, ctx.body, { idempotencyKey: ctx.idempotencyKey!, requestHash: ctx.requestHash! })), { status: 201 }));
