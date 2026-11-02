import { handler } from '@/src/http/handler';
import { actorCtx } from '@/src/security/actor';
import { runDue } from '@/src/jobs/run-due';
export const POST = handler({ capability: 'campaign.start' }, async ctx => ctx.ok(await runDue(actorCtx(ctx.actor, ctx.correlationId))));
