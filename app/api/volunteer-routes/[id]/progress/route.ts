import { handler } from '@/src/http/handler';
import { idParam } from '@/src/application/flo/route-helpers';
import { volunteerCommand } from '@/src/application/volunteers/commands';
import { volunteerRouteProgressBody } from '@/src/contracts/volunteers';
import { DomainError } from '@/src/db/errors';

export const POST = handler({
  body: volunteerRouteProgressBody,
  idempotent: true,
  route: '/api/volunteer-routes/[id]/progress',
  notFoundOnForbidden: true,
}, async (ctx) => {
  const capability = ctx.body.action === 'cancel' ? 'route.manage'
    : ctx.body.action === 'release' ? 'route.claim'
      : 'route.progress';
  if (!ctx.actor.capabilities.includes(capability)) {
    throw new DomainError({ code: 'CAPABILITY_REQUIRED', message: `${capability} is required`, http: 403 });
  }
  const { action, ...payload } = ctx.body;
  const result = await ctx.tx((c) => volunteerCommand(c, action, idParam(ctx.params), payload, {
    idempotencyKey: ctx.idempotencyKey!,
    requestHash: ctx.requestHash!,
  }));
  return ctx.ok(result, { revision: result.revision });
});
