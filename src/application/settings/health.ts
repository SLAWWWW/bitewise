/**
 * Web health probe for GET /api/health. Returns no tenant data.
 *
 * DB: one trivial transaction on the app role (lumbung_app) with an EMPTY tenant
 * context, so RLS hides every tenant row from it.
 *
 * Schema version = highest applied migration in `lumbung.schema_migrations`. The app
 * role can only read it if W1-DB grants `SELECT (version, name)` on that table (or
 * provides `lumbung.schema_version()`); the probe checks privileges first and never
 * fails because of them. `expected` is the newest migration file shipped with this
 * build (db/migrations), so a deploy that forgot to migrate shows `up_to_date: false`.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { getEnv, type AppMode } from '@/src/config/env';
import { isDomainError } from '@/src/db/errors';
import { withTx } from '@/src/db/tx';

export interface SchemaInfo {
  /** Highest applied migration, e.g. { version: 12, name: '0012_rls_grants.sql' }; null if unreadable. */
  applied: { version: number; name: string } | null;
  /** How `applied` was obtained. */
  source: 'function' | 'table' | 'not_readable_by_app_role';
  /** Newest migration file in this build's db/migrations (null if the directory is absent). */
  expected: { version: number; name: string } | null;
  /** applied === expected (null when either is unknown). */
  up_to_date: boolean | null;
}

export interface HealthReport {
  status: 'ok' | 'unavailable';
  mode: AppMode;
  db: { ok: boolean; latency_ms: number | null; error?: string };
  schema: SchemaInfo | null;
}

const MIGRATION_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Newest NNNN_name.sql in db/migrations (pure fs; tolerant of a missing directory). */
export function expectedMigration(root: string = process.cwd()): { version: number; name: string } | null {
  let names: string[];
  try {
    names = readdirSync(path.join(root, 'db', 'migrations'));
  } catch {
    return null;
  }
  let best: { version: number; name: string } | null = null;
  for (const n of names) {
    const m = MIGRATION_RE.exec(n);
    if (!m) continue;
    const v = Number(m[1]);
    if (!best || v > best.version) best = { version: v, name: n };
  }
  return best;
}

export async function checkHealth(correlationId: string = randomUUID()): Promise<HealthReport> {
  const mode = getEnv().APP_MODE;
  const started = performance.now();
  try {
    const schema = await withTx(
      { tenantId: null, userId: null, actorKind: 'SYSTEM', correlationId },
      async (c) => {
        const probe = await c.query<{ ok: number; fn: boolean; cols: boolean }>(
          `SELECT 1 AS ok,
                  CASE WHEN to_regprocedure('lumbung.schema_version()') IS NULL THEN false
                       ELSE has_function_privilege(to_regprocedure('lumbung.schema_version()'), 'EXECUTE') END AS fn,
                  CASE WHEN to_regclass('lumbung.schema_migrations') IS NULL THEN false
                       ELSE has_column_privilege(to_regclass('lumbung.schema_migrations'), 'version', 'SELECT')
                        AND has_column_privilege(to_regclass('lumbung.schema_migrations'), 'name', 'SELECT') END AS cols`,
        );
        const p = probe.rows[0];
        let applied: SchemaInfo['applied'] = null;
        let source: SchemaInfo['source'] = 'not_readable_by_app_role';
        if (p.fn) {
          const r = await c.query<{ v: unknown }>(`SELECT lumbung.schema_version() AS v`);
          applied = normaliseVersion(r.rows[0]?.v);
          source = 'function';
        } else if (p.cols) {
          const r = await c.query<{ version: number; name: string }>(
            `SELECT version, name FROM lumbung.schema_migrations ORDER BY version DESC LIMIT 1`,
          );
          applied = r.rows[0] ?? null;
          source = 'table';
        }
        const expected = expectedMigration();
        return {
          applied,
          source,
          expected,
          up_to_date: applied && expected ? applied.version === expected.version : null,
        } satisfies SchemaInfo;
      },
      { retries: 0 },
    );
    return {
      status: 'ok',
      mode,
      db: { ok: true, latency_ms: Math.round(performance.now() - started) },
      schema,
    };
  } catch (e) {
    return {
      status: 'unavailable',
      mode,
      db: { ok: false, latency_ms: null, error: isDomainError(e) ? e.code : 'INTERNAL' },
      schema: null,
    };
  }
}

/** Accepts `int`, `'0012_x.sql'`, or `{version, name}` from a future schema_version(). */
function normaliseVersion(v: unknown): SchemaInfo['applied'] {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return { version: v, name: String(v).padStart(4, '0') };
  if (typeof v === 'string') {
    const m = /^(\d+)/.exec(v);
    return m ? { version: Number(m[1]), name: v } : null;
  }
  if (typeof v === 'object' && v && 'version' in v) {
    const o = v as { version: unknown; name?: unknown };
    return { version: Number(o.version), name: String(o.name ?? o.version) };
  }
  return null;
}
