/**
 * POST /api/flos/[id]/needs   (Idempotency-Key required)
 *   { action: 'PROPOSE', category_id, score, …, confirm? }  need.propose (+ need.confirm when confirm=true)
 *   { action: 'CONFIRM', need_id }                         need.confirm
 */
import { handler } from '@/src/http/handler';
import { requireCap } from '@/src/security/capabilities';
import { submitNeed } from '@/src/application/flo/commands';
import { needBody } from '@/src/application/flo/schemas';
import { idParam } from '@/src/application/flo/route-helpers';

export const POST = handler(
  { body: needBody, idempotent: true, route: '/api/flos/[id]/needs', notFoundOnForbidden: true },
  async ({ actor, body, params, tx, idempotencyKey, requestHash, ok }) => {
    if (body.action === 'CONFIRM') {
      requireCap(actor, 'need.confirm');
    } else {
      requireCap(actor, 'need.propose');
      if (body.confirm) requireCap(actor, 'need.confirm');
    }
    const id = idParam(params);
    const res = await tx((c) => submitNeed(c, id, body, { idempotencyKey, requestHash }));
    return ok(res, { status: body.action === 'PROPOSE' ? 201 : 200 });
  },
);
