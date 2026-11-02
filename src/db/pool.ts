/**
 * The app-role connection pool (DATABASE_URL, role lumbung_app, RLS enforced).
 *
 * Singleton on globalThis so Next.js HMR does not leak pools. Never call
 * `getPool().query(...)` for tenant data — use `withTx` so the context GUCs are set
 * (without them RLS returns nothing: fail closed).
 */
import 'server-only';
import pg from 'pg';
import { installTypeParsers } from './types';
import { getEnv } from '@/src/config/env';

installTypeParsers();

interface DbGlobal {
  __lumbungPool?: pg.Pool;
  __lumbungPoolConfig?: DbConfig;
}

export interface DbConfig {
  connectionString?: string;
  /** Max pool size (default 10). */
  max?: number;
}

const g = globalThis as unknown as DbGlobal;

/**
 * Override the connection settings (tests point this at the per-run test DB).
 * Ends the existing pool, if any, so the next `getPool()` uses the new settings.
 */
export async function configureDb(config: DbConfig): Promise<void> {
  const old = g.__lumbungPool;
  g.__lumbungPool = undefined;
  g.__lumbungPoolConfig = { ...config };
  if (old) await old.end();
}

export function getPool(): pg.Pool {
  if (!g.__lumbungPool) {
    const cfg = g.__lumbungPoolConfig ?? {};
    const connectionString = cfg.connectionString ?? getEnv().DATABASE_URL;
    const pool = new pg.Pool({
      connectionString,
      max: cfg.max ?? 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'lumbung-app',
    });
    // An idle client erroring (e.g. server restart) must not crash the process.
    pool.on('error', (err) => {
      console.error('[lumbung:db] idle client error', err.message);
    });
    g.__lumbungPool = pool;
  }
  return g.__lumbungPool;
}

/** Close the pool (scripts / test teardown). */
export async function closePool(): Promise<void> {
  const p = g.__lumbungPool;
  g.__lumbungPool = undefined;
  if (p) await p.end();
}
