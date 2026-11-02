/**
 * POST /api/agreements   upload agreement metadata + legal dates (agreement.upload,
 * Idempotency-Key required). Creates a new PENDING_VERIFICATION version; never
 * overwrites. Document upload itself is Stage 3 — `document_media_id` is optional.
 */
import { handler } from '@/src/http/handler';
import { uploadAgreement, uploadAgreementBody } from '@/src/application/agreements/commands';

export const POST = handler(
  { capability: 'agreement.upload', body: uploadAgreementBody, idempotent: true, route: '/api/agreements' },
  async ({ body, tx, idempotencyKey, requestHash, ok }) => {
    const res = await tx((c) => uploadAgreement(c, body, { idempotencyKey, requestHash }));
    return ok(res, { status: 201, revision: res.agreement.revision });
  },
);
