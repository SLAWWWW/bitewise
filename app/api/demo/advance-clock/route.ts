import { handler } from '@/src/http/handler';
import { clockBody } from '@/src/contracts/direct';
import { actorCtx } from '@/src/security/actor';
import { runDue } from '@/src/jobs/run-due';
export const POST = handler({ capability: 'demo.clock', body: clockBody, idempotent: true, route: '/api/demo/advance-clock' }, async ctx => {
  const clock = await ctx.tx(async c => (await c.query<{ clock: { now: string } }>(
    'SELECT lumbung.advance_direct_clock($1,$2,$3) AS clock', [ctx.body.minutes, ctx.idempotencyKey, ctx.requestHash])).rows[0].clock);
  const jobs = await runDue(actorCtx(ctx.actor, ctx.correlationId));
  return ctx.ok({ ...clock, jobs });
});
