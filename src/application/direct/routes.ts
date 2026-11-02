import 'server-only';
import type { z } from 'zod';
import type { Capability } from '@/src/shared/capabilities';
import { handler } from '@/src/http/handler';
import { idParam } from '@/src/application/flo/route-helpers';
import { directCommand } from './commands';
import { actorCtx } from '@/src/security/actor';
import { runDue } from '@/src/jobs/run-due';

export function commandRoute(action: string, capability: Capability, body: z.ZodType, route: string) {
  return handler({ capability, body, idempotent: true, route, notFoundOnForbidden: true }, async ctx => {
    const result = await ctx.tx(c => directCommand(c, action, idParam(ctx.params), ctx.body,
      { idempotencyKey: ctx.idempotencyKey!, requestHash: ctx.requestHash! }));
    if (action === 'start') {
      // Failure to send does not roll back approved, persisted offers. The outbox
      // remains recoverable by the worker and the UI exposes its actual state.
      try { await runDue(actorCtx(ctx.actor, ctx.correlationId)); }
      catch { console.error(`[lumbung] ${ctx.correlationId} outbox pending worker recovery`); }
    }
    return ctx.ok(result, { revision: result.revision });
  });
}
