/**
 * Agreement commands (W2-FLO; PRD §5). Thin wrappers over the SECURITY DEFINER SQL
 * functions in db/migrations/0013_agreement_commands.sql:
 *
 *   upload_agreement   agreement.upload  new PENDING_VERIFICATION version, never overwrites;
 *                                        the document's end date + its interpretation
 *                                        (THROUGH_INCLUSIVE | UNTIL_EXCLUSIVE) are stored;
 *                                        instants derived in the tenant TZ (0015)
 *   approve_agreement  agreement.review  overlap → LB:AGREEMENT_OVERLAP_UNRESOLVED unless
 *                                        overlap_resolution = 'SUPERSEDE_PREVIOUS' (0015: an
 *                                        earlier-starting version is capped at this version's
 *                                        start, never erased; LB:AGREEMENT_RESOLUTION_GAP if a
 *                                        resolution would leave the FLO uncovered now)
 *   revoke_agreement   agreement.review  REVOKED + audit + task (+ S2 commitments hook)
 *
 * All three are idempotent (Idempotency-Key + request_hash) and the review commands
 * are guarded by expected_revision.
 */
import 'server-only';
import { z } from 'zod';
import type { Queryable } from '@/src/db/types';
import {
  END_DATE_INTERPRETATIONS,
  lastValidDateFromDocument,
  type EndDateInterpretation,
} from '@/src/domain/flo/agreement-interval';

import type { IdemArgs } from '@/src/application/flo/commands';

export { END_DATE_INTERPRETATIONS, type EndDateInterpretation };

export const OVERLAP_RESOLUTIONS = ['SUPERSEDE_PREVIOUS'] as const;
export type OverlapResolution = (typeof OVERLAP_RESOLUTIONS)[number];

export const uploadAgreementBody = z
  .object({
    flo_id: z.uuid(),
    /** Stage 3 adds document upload; until then an existing media id may be referenced. */
    document_media_id: z.uuid().nullable().optional(),
    signed_date: z.iso.date().nullable().optional(),
    /** Local legal start date (tenant time zone, WIB), inclusive. */
    valid_from_date: z.iso.date(),
    /** End date exactly as written in the document (tenant time zone, WIB). */
    document_end_date: z.iso.date(),
    /**
     * How the document words that end date — stored and audited, never inferred:
     * THROUGH_INCLUSIVE ("berlaku sampai dengan 30 Nov": last valid day) or
     * UNTIL_EXCLUSIVE ("berakhir 1 Des": first day no longer valid).
     */
    end_date_interpretation: z.enum(END_DATE_INTERPRETATIONS),
    /** Where/how the wording was read (clause, page), optional. */
    interpretation_note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => lastValidDateFromDocument(v.document_end_date, v.end_date_interpretation) >= v.valid_from_date, {
    message: 'Must leave at least one valid day after the start date',
    path: ['document_end_date'],
  });
export type UploadAgreementBody = z.infer<typeof uploadAgreementBody>;

export const approveAgreementBody = z
  .object({
    expected_revision: z.number().int().positive(),
    overlap_resolution: z.enum(OVERLAP_RESOLUTIONS).nullable().optional(),
  })
  .strict();
export type ApproveAgreementBody = z.infer<typeof approveAgreementBody>;

export const revokeAgreementBody = z
  .object({
    expected_revision: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export type RevokeAgreementBody = z.infer<typeof revokeAgreementBody>;

/** API shape returned by the SQL `agreement_json` helper. */
export interface AgreementJson {
  id: string;
  flo_id: string;
  version: number;
  review_state: string;
  status: string;
  expiring_soon: boolean;
  document_media_id: string | null;
  signed_date: string | null;
  valid_from_date: string;
  valid_through_date: string;
  /** End date as written in the document and how it was read (null = not recorded). */
  document_end_date: string | null;
  end_date_interpretation: EndDateInterpretation | null;
  interpretation_note: string | null;
  valid_from: string;
  valid_until_exclusive: string;
  /** least(valid_until_exclusive, superseded_from): when this version stops being in force. */
  effective_until: string;
  superseded_from: string | null;
  superseded_at: string | null;
  superseded_by_id: string | null;
  uploaded_by: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  supersedes_id: string | null;
  revision: number;
}

export interface UploadAgreementResult {
  agreement: AgreementJson;
  linked_renewal_tasks: number;
}

export async function uploadAgreement(c: Queryable, body: UploadAgreementBody, idem: IdemArgs): Promise<UploadAgreementResult> {
  const r = await c.query<{ r: UploadAgreementResult }>(
    `SELECT lumbung.upload_agreement($1::uuid, $2::uuid, $3::date, $4::date, $5::date, $6, $7, $8, $9) AS r`,
    [
      body.flo_id,
      body.document_media_id ?? null,
      body.signed_date ?? null,
      body.valid_from_date,
      body.document_end_date,
      body.end_date_interpretation,
      body.interpretation_note ?? null,
      idem.idempotencyKey,
      idem.requestHash,
    ],
  );
  return r.rows[0].r;
}

export interface ApproveAgreementResult {
  agreement: AgreementJson;
  overlap_resolution: OverlapResolution | null;
  /** Every overlapped version (truncated ∪ replaced). */
  superseded_agreement_ids: string[];
  /** Started earlier: stays approved, in force until this version starts. */
  truncated_agreement_ids: string[];
  /** Started at/after this version: SUPERSEDED, nothing remains in force. */
  replaced_agreement_ids: string[];
  renewal_tasks_created: number;
  renewal_tasks_closed: number;
}

export async function approveAgreement(
  c: Queryable,
  agreementId: string,
  body: ApproveAgreementBody,
  idem: IdemArgs,
): Promise<ApproveAgreementResult> {
  const r = await c.query<{ r: ApproveAgreementResult }>(
    `SELECT lumbung.approve_agreement($1::uuid, $2::int, $3, $4, $5) AS r`,
    [agreementId, body.expected_revision, body.overlap_resolution ?? null, idem.idempotencyKey, idem.requestHash],
  );
  return r.rows[0].r;
}

export interface RevokeAgreementResult {
  agreement: AgreementJson;
  task_id: string | null;
  /** Result of the commitments hook (Stage 1: a no-op reporting zeros). */
  commitments: Record<string, unknown>;
}

export async function revokeAgreement(
  c: Queryable,
  agreementId: string,
  body: RevokeAgreementBody,
  idem: IdemArgs,
): Promise<RevokeAgreementResult> {
  const r = await c.query<{ r: RevokeAgreementResult }>(
    `SELECT lumbung.revoke_agreement($1::uuid, $2::int, $3, $4, $5) AS r`,
    [agreementId, body.expected_revision, body.reason, idem.idempotencyKey, idem.requestHash],
  );
  return r.rows[0].r;
}
