/**
 * Shared database bootstrap + migration runner.
 *
 * Used by scripts/db/{bootstrap,migrate,create-test-db}.ts and by the test
 * global setup. Deliberately free of `server-only`, Next.js and env-schema
 * imports so it runs under plain `tsx` and vitest.
 *
 * Contracts (docs/architecture.md G.1 / G.5):
 *   bootstrapCluster(adminUrl)          idempotent cluster roles (db/bootstrap.sql)
 *   createDatabase(adminUrl, dbName)    database owned by lumbung_owner + schema `lumbung`
 *   runMigrations(ownerUrl)             db/migrations/NNNN_*.sql, one transaction each,
 *                                       tracked in lumbung.schema_migrations
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import pg from 'pg';

export const SCHEMA = 'lumbung';
export const OWNER_ROLE = 'lumbung_owner';
export const APP_ROLE = 'lumbung_app';

/** Local development defaults (docs/architecture.md G.1). */
export const DEFAULT_PORT = 54329;
export const DEFAULT_ADMIN_URL = `postgres://postgres:postgres@localhost:${DEFAULT_PORT}/postgres`;
export const DEFAULT_OWNER_URL = `postgres://lumbung_owner:lumbung_owner@localhost:${DEFAULT_PORT}/lumbung`;
export const DEFAULT_APP_URL = `postgres://lumbung_app:lumbung_app@localhost:${DEFAULT_PORT}/lumbung`;
export const DEFAULT_DB_NAME = 'lumbung';

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
/** Fixed advisory-lock keys (two-int form avoids hashing differences). */
const LOCK_NS = 0x4c42; // 'LB'
const LOCK_BOOTSTRAP = 1;
const LOCK_MIGRATE = 2;

export interface BootstrapOptions {
  /** Defaults to the password in DATABASE_OWNER_URL, else the G.1 dev password `lumbung_owner`. */
  ownerPassword?: string;
  /** Defaults to the password in DATABASE_URL, else the G.1 dev password `lumbung_app`. */
  appPassword?: string;
  /** Path to bootstrap.sql. Defaults to `<cwd>/db/bootstrap.sql`. */
  bootstrapSqlPath?: string;
}

export interface MigrateOptions {
  /** Defaults to `<cwd>/db/migrations`. */
  migrationsDir?: string;
  /** Called after each applied migration. */
  onApplied?: (name: string) => void;
  /**
   * Refuse pending files whose version is lower than the latest applied one.
   * Off by default: stages own disjoint number ranges (S1 0001–0019, S2
   * 0020–0039, ...) and may land out of order on a long-lived dev database.
   */
  strictOrder?: boolean;
  /** Receives non-fatal warnings (e.g. out-of-order application). */
  onWarning?: (message: string) => void;
}

export interface MigrationFile {
  version: number;
  name: string; // file name, e.g. 0001_schema_helpers.sql
  checksum: string; // sha256 hex of the raw file bytes
  sql: string;
}

function repoPath(...parts: string[]): string {
  return path.join(process.cwd(), ...parts);
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, application_name: 'lumbung-migrate' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Replace the database name (and optionally credentials) of a postgres URL. */
export function urlWith(
  url: string,
  changes: { database?: string; user?: string; password?: string },
): string {
  const u = new URL(url);
  if (changes.database !== undefined) u.pathname = `/${changes.database}`;
  if (changes.user !== undefined) u.username = encodeURIComponent(changes.user);
  if (changes.password !== undefined) u.password = encodeURIComponent(changes.password);
  return u.toString();
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

export function passwordOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const pw = new URL(url).password;
  return pw ? decodeURIComponent(pw) : undefined;
}

/**
 * Role passwords the rest of the toolchain expects: taken from DATABASE_OWNER_URL /
 * DATABASE_URL (as scripts/db/bootstrap.ts does), falling back to the G.1 development
 * defaults. Roles are cluster-wide, so any bootstrap against a shared server (e.g. the
 * test global setup reusing the dev server on :54329) must use these, or it silently
 * resets the dev web/seed credentials.
 */
export function rolePasswordsFromEnv(env: Record<string, string | undefined> = process.env): {
  ownerPassword: string;
  appPassword: string;
} {
  return {
    ownerPassword: passwordOf(env.DATABASE_OWNER_URL) ?? 'lumbung_owner',
    appPassword: passwordOf(env.DATABASE_URL) ?? 'lumbung_app',
  };
}

export function assertDbName(dbName: string): void {
  if (!DB_NAME.test(dbName)) {
    throw new Error(`Invalid database name "${dbName}" (expected ${DB_NAME})`);
  }
}

/**
 * Idempotently create/align the cluster roles lumbung_owner and lumbung_app.
 * Safe to run concurrently from several processes (advisory lock).
 */
export async function bootstrapCluster(adminUrl: string, opts: BootstrapOptions = {}): Promise<void> {
  const sql = readFileSync(opts.bootstrapSqlPath ?? repoPath('db', 'bootstrap.sql'), 'utf8');
  const envPw = rolePasswordsFromEnv();
  const pw = {
    ownerPassword: opts.ownerPassword ?? envPw.ownerPassword,
    appPassword: opts.appPassword ?? envPw.appPassword,
  };
  await withClient(adminUrl, async (c) => {
    await c.query('SELECT pg_advisory_lock($1, $2)', [LOCK_NS, LOCK_BOOTSTRAP]);
    try {
      await c.query('BEGIN');
      await c.query(
        `SELECT set_config('lumbung.bootstrap_owner_password', $1, true),
                set_config('lumbung.bootstrap_app_password', $2, true)`,
        [pw.ownerPassword, pw.appPassword],
      );
      await c.query(sql);
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      await c.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NS, LOCK_BOOTSTRAP]).catch(() => undefined);
    }
  });
}

export async function databaseExists(adminUrl: string, dbName: string): Promise<boolean> {
  return withClient(adminUrl, async (c) => {
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    return (r.rowCount ?? 0) > 0;
  });
}

/**
 * CREATE DATABASE owned by lumbung_owner, lock it down, and create schema
 * `lumbung` (owned by lumbung_owner) inside it. Requires bootstrapCluster first.
 * Throws if the database already exists.
 */
export async function createDatabase(adminUrl: string, dbName: string): Promise<void> {
  assertDbName(dbName);
  await withClient(adminUrl, async (c) => {
    const db = c.escapeIdentifier(dbName);
    // CREATE DATABASE cannot run inside a transaction block.
    await c.query(`CREATE DATABASE ${db} OWNER ${OWNER_ROLE} ENCODING 'UTF8' TEMPLATE template0`);
    await c.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await c.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${APP_ROLE}`);
    // Supabase runs UTC; never depend on the machine's TZ (+08 here).
    await c.query(`ALTER DATABASE ${db} SET timezone TO 'UTC'`);
    await c.query(`ALTER ROLE ${APP_ROLE} IN DATABASE ${db} SET search_path TO ${SCHEMA}, pg_temp`);
    await c.query(`ALTER ROLE ${OWNER_ROLE} IN DATABASE ${db} SET search_path TO ${SCHEMA}, pg_temp`);
  });
  await withClient(urlWith(adminUrl, { database: dbName }), async (c) => {
    await c.query('BEGIN');
    await c.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA} AUTHORIZATION ${OWNER_ROLE}`);
    await c.query(`REVOKE ALL ON SCHEMA ${SCHEMA} FROM PUBLIC`);
    await c.query('COMMIT');
  });
}

/** DROP DATABASE IF EXISTS ... WITH (FORCE). For tests and create-test-db. */
export async function dropDatabase(adminUrl: string, dbName: string): Promise<void> {
  assertDbName(dbName);
  await withClient(adminUrl, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${c.escapeIdentifier(dbName)} WITH (FORCE)`);
  });
}

/** Read and validate db/migrations/NNNN_name.sql files in version order. */
export function readMigrationFiles(migrationsDir = repoPath('db', 'migrations')): MigrationFile[] {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Map<number, string>();
  const out: MigrationFile[] = [];
  for (const name of files) {
    const m = MIGRATION_FILE.exec(name);
    if (!m) throw new Error(`Migration file name "${name}" does not match NNNN_name.sql`);
    const version = Number(m[1]);
    const dup = seen.get(version);
    if (dup) throw new Error(`Duplicate migration version ${m[1]}: ${dup} and ${name}`);
    seen.set(version, name);
    const buf = readFileSync(path.join(migrationsDir, name));
    out.push({
      version,
      name,
      checksum: createHash('sha256').update(buf).digest('hex'),
      sql: buf.toString('utf8'),
    });
  }
  return out.sort((a, b) => a.version - b.version);
}

/**
 * Apply pending migrations in order, each inside its own transaction, as the
 * owner role. Refuses to run if an already-applied file changed (checksum) or
 * disappeared. Returns the file names applied by this call ([] = no-op).
 * Concurrent runners against the same database serialise on an advisory lock.
 */
export async function runMigrations(ownerUrl: string, opts: MigrateOptions = {}): Promise<string[]> {
  const files = readMigrationFiles(opts.migrationsDir);
  return withClient(ownerUrl, async (c) => {
    await c.query('SELECT pg_advisory_lock($1, $2)', [LOCK_NS, LOCK_MIGRATE]);
    try {
      await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
          version    integer PRIMARY KEY,
          name       text NOT NULL UNIQUE,
          checksum   text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      const applied = await c.query<{ version: number; name: string; checksum: string }>(
        `SELECT version, name, checksum FROM ${SCHEMA}.schema_migrations ORDER BY version`,
      );
      const byVersion = new Map(files.map((f) => [f.version, f]));
      for (const row of applied.rows) {
        const f = byVersion.get(row.version);
        if (!f) {
          throw new Error(`Applied migration ${row.name} is missing from the migrations directory`);
        }
        if (f.name !== row.name) {
          throw new Error(`Applied migration ${row.version} was renamed: ${row.name} -> ${f.name}`);
        }
        if (f.checksum !== row.checksum) {
          throw new Error(
            `Checksum mismatch for applied migration ${row.name}: database has ${row.checksum}, file has ${f.checksum}. ` +
              'Never edit an applied migration; add a new one.',
          );
        }
      }
      const appliedVersions = new Set(applied.rows.map((r) => r.version));
      const maxApplied = applied.rows.reduce((m, r) => Math.max(m, r.version), 0);
      const pending = files.filter((f) => !appliedVersions.has(f.version));
      const outOfOrder = pending.filter((f) => f.version < maxApplied);
      if (outOfOrder.length > 0) {
        const msg = `Pending migration(s) older than the latest applied (${maxApplied}): ${outOfOrder
          .map((f) => f.name)
          .join(', ')}`;
        if (opts.strictOrder) throw new Error(msg);
        opts.onWarning?.(msg);
      }
      const done: string[] = [];
      for (const f of pending) {
        await c.query('BEGIN');
        try {
          await c.query(`SET LOCAL search_path TO ${SCHEMA}, pg_temp`);
          await c.query(f.sql);
          await c.query(
            `INSERT INTO ${SCHEMA}.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
            [f.version, f.name, f.checksum],
          );
          await c.query('COMMIT');
        } catch (err) {
          await c.query('ROLLBACK').catch(() => undefined);
          const e = err as Error & { position?: string };
          e.message = `Migration ${f.name} failed: ${e.message}${e.position ? ` (at char ${e.position})` : ''}`;
          throw e;
        }
        done.push(f.name);
        opts.onApplied?.(f.name);
      }
      return done;
    } finally {
      await c.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NS, LOCK_MIGRATE]).catch(() => undefined);
    }
  });
}

/** True when a server answers on `url` within `timeoutMs`. */
export async function canConnect(url: string, timeoutMs = 1500): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface ScratchDatabase {
  dbName: string;
  adminUrl: string;
  ownerUrl: string;
  appUrl: string;
  applied: string[];
  drop: () => Promise<void>;
}

/**
 * bootstrap roles + create a uniquely named database + migrate it.
 * Role passwords default to rolePasswordsFromEnv() (DATABASE_OWNER_URL / DATABASE_URL,
 * else the G.1 development defaults) so a shared cluster keeps its configured passwords.
 */
export async function createMigratedDatabase(
  adminUrl: string,
  dbName: string,
  opts: BootstrapOptions & MigrateOptions = {},
): Promise<ScratchDatabase> {
  const envPw = rolePasswordsFromEnv();
  const ownerPassword = opts.ownerPassword ?? envPw.ownerPassword;
  const appPassword = opts.appPassword ?? envPw.appPassword;
  await bootstrapCluster(adminUrl, { ...opts, ownerPassword, appPassword });
  await createDatabase(adminUrl, dbName);
  const ownerUrl = urlWith(adminUrl, { database: dbName, user: OWNER_ROLE, password: ownerPassword });
  const appUrl = urlWith(adminUrl, { database: dbName, user: APP_ROLE, password: appPassword });
  const applied = await runMigrations(ownerUrl, opts);
  return {
    dbName,
    adminUrl,
    ownerUrl,
    appUrl,
    applied,
    drop: () => dropDatabase(adminUrl, dbName),
  };
}

/**
 * Load `.env.local` then `.env` (repo root) into process.env without
 * overriding variables that are already set. For the CLI scripts only; the
 * app gets env from Next.
 */
export function loadLocalEnv(dir = process.cwd()): void {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(dir, file);
    if (!existsSync(p)) continue;
    const parsed = parseEnv(readFileSync(p, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined && v !== undefined) process.env[k] = v;
    }
  }
}
