/**
 * GET   /api/flos/[id]   scoped detail (contacts decrypted only for flo.edit holders,
 *                        audit only for audit.read holders). Another tenant's id → 404.
 * PATCH /api/flos/[id]   revision-guarded profile edit { expected_revision, patch }
 *                        (Idempotency-Key required).
 */
import { DomainError } from '@/src/db/errors';
import { handler } from '@/src/http/handler';
import { hasCap } from '@/src/security/capabilities';
import { getFlo } from '@/src/application/flo/queries';
import { updateFloProfile } from '@/src/application/flo/commands';
import { patchFloBody } from '@/src/application/flo/schemas';
import { idParam } from '@/src/application/flo/route-helpers';

export const GET = handler({ capability: 'flo.read', notFoundOnForbidden: true }, async ({ actor, params, tx, ok }) => {
  const id = idParam(params);
  const detail = await tx((c) =>
    getFlo(c, id, { revealContacts: hasCap(actor, 'flo.edit'), includeAudit: hasCap(actor, 'audit.read') }),
  );
  if (!detail) throw new DomainError({ code: 'NOT_FOUND', message: 'Not found' });
  return ok(detail, { revision: detail.profile.revision });
});

export const PATCH = handler(
  { capability: 'flo.edit', body: patchFloBody, idempotent: true, route: '/api/flos/[id]', notFoundOnForbidden: true },
  async ({ body, params, tx, idempotencyKey, requestHash, ok }) => {
    const id = idParam(params);
    const res = await tx((c) => updateFloProfile(c, id, body, { idempotencyKey, requestHash }));
    return ok(res, { revision: res.revision });
  },
);
