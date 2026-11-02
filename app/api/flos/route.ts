/**
 * GET  /api/flos   filtered directory with agreement and performance summaries
 *                  (?area&cluster&type&status&agreement&need&response&q&cursor&limit)
 * POST /api/flos   draft FLO creation; no implicit verification (Idempotency-Key required)
 */
import { handler } from '@/src/http/handler';
import { listFlos } from '@/src/application/flo/queries';
import { createFlo } from '@/src/application/flo/commands';
import { createFloBody, floListQuery } from '@/src/application/flo/schemas';

export const GET = handler({ capability: 'flo.read', query: floListQuery }, async ({ query, tx, ok }) => {
  const { cursor, limit, ...filters } = query;
  const result = await tx((c) => listFlos(c, filters, { cursor, limit }));
  return ok(result);
});

export const POST = handler(
  { capability: 'flo.edit', body: createFloBody, idempotent: true, route: '/api/flos' },
  async ({ body, tx, idempotencyKey, requestHash, ok }) => {
    const created = await tx((c) => createFlo(c, body, { idempotencyKey, requestHash }));
    return ok(created, { status: 201, revision: created.revision });
  },
);
