import { handler } from '@/src/http/handler';
import { idParam } from '@/src/application/flo/route-helpers';
import { getDonation } from '@/src/application/direct/queries';
import { DomainError } from '@/src/db/errors';
export const GET = handler({ capability: 'flo.read', notFoundOnForbidden: true }, async ctx => {
  const row = await ctx.tx(c => getDonation(c, idParam(ctx.params)));
  if (!row) throw new DomainError({ code: 'NOT_FOUND' });
  return ctx.ok(row);
});
