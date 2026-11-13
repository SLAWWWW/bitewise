import { handler } from '@/src/http/handler';
import { publishVolunteerRouteBody } from '@/src/contracts/volunteers';
import { volunteerCommand } from '@/src/application/volunteers/commands';

export const POST = handler({
  capability: 'route.manage',
  body: publishVolunteerRouteBody,
  idempotent: true,
  route: '/api/volunteer-routes',
}, async (ctx) => {
  const { delivery_id, ...payload } = ctx.body;
  const result = await ctx.tx((c) => volunteerCommand(c, 'publish', delivery_id, payload, {
    idempotencyKey: ctx.idempotencyKey!,
    requestHash: ctx.requestHash!,
  }));
  return ctx.ok(result, { status: 201, revision: result.revision });
});
