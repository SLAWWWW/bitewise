/**
 * FLO commands (W2-FLO). Thin wrappers over the SECURITY DEFINER functions of
 * db/migrations/0013_agreement_commands.sql; the SQL re-checks capability, tenant,
 * revision and idempotency. Call inside `withTx` / the route handler's `tx()`.
 */
import 'server-only';
import { DomainError } from '@/src/db/errors';
import type { Queryable } from '@/src/db/types';
import { deriveIdempotencyKey } from '@/src/http/idempotency';
import type { CreateFloBody, NeedBody, PatchFloBody } from './schemas';

export interface IdemArgs {
  idempotencyKey: string | null;
  requestHash: string | null;
}

export interface CreateFloResult {
  flo_id: string;
  code: string;
  status: string;
  tenure: string;
  revision: number;
}

export async function createFlo(c: Queryable, body: CreateFloBody, idem: IdemArgs): Promise<CreateFloResult> {
  const r = await c.query<{ r: CreateFloResult }>(`SELECT lumbung.create_flo($1::jsonb, $2, $3) AS r`, [
    JSON.stringify(body),
    idem.idempotencyKey,
    idem.requestHash,
  ]);
  return r.rows[0].r;
}

export interface UpdateFloResult {
  flo_id: string;
  revision: number;
  changed: string[];
}

export async function updateFloProfile(
  c: Queryable,
  floId: string,
  body: PatchFloBody,
  idem: IdemArgs,
): Promise<UpdateFloResult> {
  const r = await c.query<{ r: UpdateFloResult }>(
    `SELECT lumbung.update_flo_profile($1::uuid, $2::int, $3::jsonb, $4, $5) AS r`,
    [floId, body.expected_revision, JSON.stringify(body.patch), idem.idempotencyKey, idem.requestHash],
  );
  return r.rows[0].r;
}

export interface NeedResult {
  need_id: string;
  flo_id: string;
  category_id: string;
  score: number;
  status: 'PROPOSED' | 'CONFIRMED';
  assessed_at: string;
  expires_at: string;
  confirmed_by?: string;
}

/**
 * PROPOSE (optionally confirming in the same transaction — a staff-assessed need)
 * or CONFIRM. The confirm step of a PROPOSE+confirm uses a fixed-length key derived
 * from the client key (deriveIdempotencyKey(key, 'confirm')), so a replay of the whole
 * request replays both steps and a maximum-length (200-char) client key still fits.
 */
export async function submitNeed(c: Queryable, floId: string, body: NeedBody, idem: IdemArgs): Promise<NeedResult> {
  if (body.action === 'CONFIRM') {
    return confirmNeed(c, floId, body.need_id, idem);
  }
  const r = await c.query<{ r: NeedResult }>(
    `SELECT lumbung.propose_need($1::uuid, $2::uuid, $3::numeric, $4, $5::numeric, $6, $7::date, $8::numeric,
                                 $9::numeric, $10, $11::int, $12, $13) AS r`,
    [
      floId,
      body.category_id,
      body.score,
      body.basis ?? null,
      body.requested_qty ?? null,
      body.unit ?? null,
      body.intended_distribution_date ?? null,
      body.available_stock_qty ?? null,
      body.expected_deliveries_qty ?? null,
      body.existing_support ?? null,
      body.valid_days,
      idem.idempotencyKey,
      idem.requestHash,
    ],
  );
  const proposed = r.rows[0].r;
  if (!body.confirm) return proposed;
  return confirmNeed(c, floId, proposed.need_id, {
    idempotencyKey: idem.idempotencyKey ? deriveIdempotencyKey(idem.idempotencyKey, 'confirm') : null,
    requestHash: idem.requestHash,
  });
}

async function confirmNeed(c: Queryable, floId: string, needId: string, idem: IdemArgs): Promise<NeedResult> {
  // Scope check: the need must belong to the FLO in the URL (RLS already scopes the tenant).
  const own = await c.query(`SELECT 1 FROM lumbung.need_assessments WHERE id = $1 AND flo_id = $2`, [needId, floId]);
  if (own.rowCount === 0) {
    throw new DomainError({ code: 'NOT_FOUND', message: 'Need assessment not found' });
  }
  const r = await c.query<{ r: NeedResult }>(`SELECT lumbung.confirm_need($1::uuid, $2, $3) AS r`, [
    needId,
    idem.idempotencyKey,
    idem.requestHash,
  ]);
  return r.rows[0].r;
}
