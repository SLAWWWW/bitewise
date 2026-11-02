/**
 * Transaction runner with tenant context (architecture A.3, G.2).
 *
 *   BEGIN
 *   SELECT set_config('app.tenant_id',$1,true), ... (five GUCs, ONE statement)
 *   <fn(client)>
 *   COMMIT            (ROLLBACK on error)
 *
 * Retries serialization failures / deadlocks (40001, 40P01) with jittered backoff.
 * Errors are rethrown as DomainError (see ./errors). The client is always released.
 */
import 'server-only';
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { getPool } from './pool';
import { isRetryablePgError, mapDbError } from './errors';
import type { DbCtx, TxClient } from './types';

export interface TxOptions {
  /** Max retries after the first attempt for 40001/40P01 (default 3). */
  retries?: number;
  /** Override the pool (tests / owner scripts). Defaults to the app pool. */
  pool?: pg.Pool;
}

export const SET_CONTEXT_SQL =
  "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), " +
  "set_config('app.actor_kind', $3, true), set_config('app.link_id', $4, true), " +
  "set_config('app.correlation_id', $5, true)";

export function contextParams(ctx: DbCtx): [string, string, string, string, string] {
  return [ctx.tenantId ?? '', ctx.userId ?? '', ctx.actorKind, ctx.linkId ?? '', ctx.correlationId ?? ''];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 20–60 ms, 40–120 ms, 80–240 ms ... (infrastructure jitter, not domain logic). */
function backoffMs(attempt: number): number {
  const base = 20 * 2 ** attempt;
  return base + randomInt(0, base * 2 + 1);
}

export async function withTx<T>(
  ctx: DbCtx,
  fn: (client: TxClient) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const pool = opts.pool ?? getPool();
  for (let attempt = 0; ; attempt++) {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch (e) {
      throw mapDbError(e);
    }
    let broken = false;
    let retry = false;
    try {
      await client.query('BEGIN');
      await client.query(SET_CONTEXT_SQL, contextParams(ctx));
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // connection unusable: destroy instead of returning to the pool
      }
      if (isRetryablePgError(e) && attempt < retries) {
        retry = true;
      } else {
        throw mapDbError(e);
      }
    } finally {
      client.release(broken);
    }
    if (retry) await sleep(backoffMs(attempt));
  }
}
