/**
 * POST /api/agreements/[id]/revoke   reviewer revokes { expected_revision, reason }.
 * Idempotency-Key required. Stage 1: REVOKED + audit + task; Stage 2 extends the SQL
 * hook `on_agreement_revoked` to invalidate affected commitments.
 */
import { handler } from '@/src/http/handler';
import { revokeAgreement, revokeAgreementBody } from '@/src/application/agreements/commands';
import { idParam } from '@/src/application/flo/route-helpers';

export const POST = handler(
  {
    capability: 'agreement.review',
    body: revokeAgreementBody,
    idempotent: true,
    route: '/api/agreements/[id]/revoke',
    notFoundOnForbidden: true,
  },
  async ({ body, params, tx, idempotencyKey, requestHash, ok }) => {
    const id = idParam(params);
    const res = await tx((c) => revokeAgreement(c, id, body, { idempotencyKey, requestHash }));
    return ok(res, { revision: res.agreement.revision });
  },
);
