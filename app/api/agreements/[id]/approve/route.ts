/**
 * POST /api/agreements/[id]/approve   reviewer confirms document and effective dates.
 * Body { expected_revision, overlap_resolution?: 'SUPERSEDE_PREVIOUS' }.
 * Idempotency-Key required. Overlap without resolution → 409 AGREEMENT_OVERLAP_UNRESOLVED.
 */
import { handler } from '@/src/http/handler';
import { approveAgreement, approveAgreementBody } from '@/src/application/agreements/commands';
import { idParam } from '@/src/application/flo/route-helpers';

export const POST = handler(
  {
    capability: 'agreement.review',
    body: approveAgreementBody,
    idempotent: true,
    route: '/api/agreements/[id]/approve',
    notFoundOnForbidden: true,
  },
  async ({ body, params, tx, idempotencyKey, requestHash, ok }) => {
    const id = idParam(params);
    const res = await tx((c) => approveAgreement(c, id, body, { idempotencyKey, requestHash }));
    return ok(res, { revision: res.agreement.revision });
  },
);
