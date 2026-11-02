/**
 * Owner-role pool helper for CLI scripts and test setup ONLY (migrate / seed / reset).
 *
 * Uses DATABASE_OWNER_URL (role lumbung_owner, bypasses RLS). Must never be imported
 * from `app/**` route handlers or server components; the LIVE web process refuses to
 * start when DATABASE_OWNER_URL is set (src/config/env.ts).
 */
import pg from 'pg';
import { installTypeParsers } from './types';

installTypeParsers();

export function ownerConnectionString(explicit?: string): string {
  const url = explicit ?? process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is not set (owner pool is for scripts/tests only)');
  if (process.env.APP_MODE === 'LIVE' && process.env.NEXT_RUNTIME) {
    throw new Error('Owner pool must not be used inside the LIVE web process');
  }
  return url;
}

export function createOwnerPool(connectionString?: string, max = 4): pg.Pool {
  const pool = new pg.Pool({
    connectionString: ownerConnectionString(connectionString),
    max,
    application_name: 'lumbung-owner',
  });
  pool.on('error', (err) => console.error('[lumbung:db:owner] idle client error', err.message));
  return pool;
}

/** Run `fn` with a short-lived owner pool and always close it. */
export async function withOwnerPool<T>(
  fn: (pool: pg.Pool) => Promise<T>,
  connectionString?: string,
): Promise<T> {
  const pool = createOwnerPool(connectionString);
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}
