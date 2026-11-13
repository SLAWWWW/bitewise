import 'server-only';
import type { z } from 'zod';
import type { Capability } from '@/src/shared/capabilities';
import { handler } from '@/src/http/handler';
import { idParam } from '@/src/application/flo/route-helpers';
import { volunteerCommand } from './commands';

export function volunteerCommandRoute(action: string, capability: Capability, body: z.ZodType, route: string) {
  return handler({ capability, body, idempotent: true, route, notFoundOnForbidden: true }, async (ctx) => {
    const result = await ctx.tx((c) => volunteerCommand(c, action, idParam(ctx.params), ctx.body, {
      idempotencyKey: ctx.idempotencyKey!,
      requestHash: ctx.requestHash!,
    }));
    return ctx.ok(result, { revision: result.revision });
  });
}
