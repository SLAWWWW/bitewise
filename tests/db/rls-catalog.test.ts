/**
 * Catalog-driven security checks (AC40 catalog part, AC41 support):
 *  - every table in schema lumbung with a tenant_id column has RLS enabled and
 *    a policy for lumbung_app that isolates by current_tenant()
 *  - no FORCE RLS (owner / SECURITY DEFINER bypass is explicit by design)
 *  - every SECURITY DEFINER function pins search_path = lumbung, pg_temp and
 *    calls require_ctx(
 *  - no function in the schema is executable by PUBLIC (incl. NULL acl = default)
 *  - future functions created by the owner are not PUBLIC-executable
 *  - lumbung_app is not superuser / bypassrls / owner of anything / member of owner
 *  - views run as security_invoker
 *
 * Runs against the shared test database (tests/setup/global-db.ts); falls back
 * to a private migrated database when run without the global setup.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_ADMIN_URL, createMigratedDatabase, type ScratchDatabase } from '@/src/db/migrate-lib';
import { ensureCluster, type ClusterHandle } from '@/scripts/db/start';

function provided(key: 'TEST_DATABASE_URL' | 'TEST_DATABASE_OWNER_URL'): string | undefined {
  try {
    return (inject as (k: string) => string | undefined)(key) ?? process.env[key];
  } catch {
    return process.env[key];
  }
}

let owner: pg.Client;
let privateCluster: ClusterHandle | null = null;
let privateDb: ScratchDatabase | null = null;

beforeAll(async () => {
  let ownerUrl = provided('TEST_DATABASE_OWNER_URL');
  if (!ownerUrl) {
    privateCluster = await ensureCluster(
      [process.env.TEST_DATABASE_ADMIN_URL, process.env.DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL],
      { dirPrefix: 'pg-dbtest-rls' },
    );
    privateDb = await createMigratedDatabase(
      privateCluster.adminUrl,
      `lumbung_t_rls_${process.pid}_${randomBytes(3).toString('hex')}`,
    );
    ownerUrl = privateDb.ownerUrl;
  }
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
}, 120_000);

afterAll(async () => {
  await owner?.end();
  await privateDb?.drop();
  await privateCluster?.stop();
}, 120_000);

async function rows<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await owner.query<T>(sql, params)).rows;
}

describe('row-level security catalog', () => {
  it('enables RLS with a tenant-isolating policy on every table that has tenant_id', async () => {
    const tables = await rows<{ relname: string; rls: boolean; force: boolean; policies: string[] | null }>(
      `SELECT c.relname,
              c.relrowsecurity AS rls,
              c.relforcerowsecurity AS force,
              (SELECT array_agg(p.polname ORDER BY p.polname)
                 FROM pg_policy p
                WHERE p.polrelid = c.oid
                  AND (p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'lumbung_app')]
                       OR p.polroles = '{0}')) AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
        ORDER BY c.relname`,
    );
    // Sanity: the S1 schema has dozens of tenant tables.
    expect(tables.length).toBeGreaterThan(60);
    const offenders = tables.filter((t) => !t.rls || t.force || !t.policies || t.policies.length === 0);
    expect(offenders).toEqual([]);
  });

  it('isolates by current_tenant() in every policy USING clause of tenant tables', async () => {
    const policies = await rows<{ table: string; policy: string; using: string | null }>(
      `SELECT c.relname AS table, p.polname AS policy, pg_get_expr(p.polqual, p.polrelid) AS using
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung'
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
          AND p.polcmd IN ('r','*')
        ORDER BY 1, 2`,
    );
    expect(policies.length).toBeGreaterThan(60);
    const isolating = /\(?tenant_id = \(\s*SELECT (lumbung\.)?current_tenant\(\)/;
    expect(policies.filter((p) => !isolating.test(p.using ?? ''))).toEqual([]);
  });

  it('enables RLS on every table except the owner-only migration ledger', async () => {
    const noRls = await rows<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
        ORDER BY 1`,
    );
    expect(noRls.map((r) => r.relname)).toEqual(['schema_migrations']);
    // 0014: the app may read only (version, name) for GET /api/health; no table-level
    // SELECT, no checksum/applied_at, no writes.
    const [priv] = await rows<{ table_select: boolean; version: boolean; name: boolean; checksum: boolean; applied_at: boolean; write: boolean }>(
      `SELECT has_table_privilege('lumbung_app', 'lumbung.schema_migrations', 'SELECT') AS table_select,
              has_column_privilege('lumbung_app', 'lumbung.schema_migrations', 'version', 'SELECT') AS version,
              has_column_privilege('lumbung_app', 'lumbung.schema_migrations', 'name', 'SELECT') AS name,
              has_column_privilege('lumbung_app', 'lumbung.schema_migrations', 'checksum', 'SELECT') AS checksum,
              has_column_privilege('lumbung_app', 'lumbung.schema_migrations', 'applied_at', 'SELECT') AS applied_at,
              has_table_privilege('lumbung_app', 'lumbung.schema_migrations', 'INSERT, UPDATE, DELETE, TRUNCATE') AS write`,
    );
    expect(priv).toEqual({ table_select: false, version: true, name: true, checksum: false, applied_at: false, write: false });
  });

  it('runs every view in the schema as security_invoker', async () => {
    const views = await rows<{ relname: string; invoker: boolean }>(
      `SELECT c.relname, coalesce('security_invoker=true' = ANY (c.reloptions), false) AS invoker
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND c.relkind IN ('v','m') ORDER BY 1`,
    );
    expect(views.length).toBeGreaterThan(0);
    expect(views.filter((v) => !v.invoker)).toEqual([]);
  });
});

describe('function catalog', () => {
  it('pins search_path on every SECURITY DEFINER function and calls require_ctx(', async () => {
    const defs = await rows<{ sig: string; config: string[] | null; src: string }>(
      `SELECT p.oid::regprocedure::text AS sig, p.proconfig AS config, p.prosrc AS src
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'lumbung' AND p.prosecdef ORDER BY 1`,
    );
    expect(defs.map((d) => d.sig.replace(/^lumbung\./, ''))).toContain('require_cap(text)');
    const badPath = defs.filter((d) => !(d.config ?? []).includes('search_path=lumbung, pg_temp'));
    expect(badPath).toEqual([]);
    // Allow-list: functions that by design run before any tenant context exists.
    // demo_login_directory() (0014) is the pre-login demo directory; it must filter to
    // DEMO/TEST demo tenants (asserted below and in tenant-isolation-matrix).
    const PRE_CONTEXT_ALLOWLIST = new Set(['demo_login_directory()']);
    const noCtx = defs.filter(
      (d) => !/\brequire_ctx\s*\(/.test(d.src) && !PRE_CONTEXT_ALLOWLIST.has(d.sig.replace(/^lumbung\./, '')),
    );
    expect(noCtx.map((d) => d.sig)).toEqual([]);
    const dir = defs.find((d) => d.sig.replace(/^lumbung\./, '') === 'demo_login_directory()');
    expect(dir, 'demo_login_directory() exists').toBeDefined();
    expect(dir!.src).toMatch(/t\.mode IN \('DEMO','TEST'\) AND t\.is_demo/);
  });

  it('grants EXECUTE to PUBLIC on no function in the schema (NULL acl counts as PUBLIC)', async () => {
    const publicExec = await rows<{ sig: string }>(
      `SELECT p.oid::regprocedure::text AS sig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        WHERE n.nspname = 'lumbung' AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ORDER BY 1`,
    );
    expect(publicExec).toEqual([]);
  });

  it('keeps internal helpers owner-only and the public helper set app-executable', async () => {
    const check = async (sig: string) =>
      (await rows<{ ok: boolean }>(`SELECT has_function_privilege('lumbung_app', $1, 'EXECUTE') AS ok`, [sig]))[0].ok;
    for (const sig of [
      'lumbung.verify_tenant_invariants(uuid)',
      'lumbung.demo_reset_begin(text)',
      'lumbung.apply_tenant_rls(regclass,boolean)',
      'lumbung.agreement_valid_at_for(uuid,uuid,timestamptz)',
    ]) {
      expect(await check(sig), sig).toBe(false);
    }
    for (const sig of [
      'lumbung.current_tenant()',
      'lumbung.require_ctx()',
      'lumbung.require_cap(text)',
      'lumbung.tenant_now()',
      'lumbung.agreement_valid_at(uuid,timestamptz)',
      'lumbung.canonical_hash(jsonb)',
    ]) {
      expect(await check(sig), sig).toBe(true);
    }
  });

  it('does not make future owner functions PUBLIC-executable (default privileges)', async () => {
    const defaults = await rows<{ acl: string[] | null }>(
      `SELECT d.defaclacl::text[] AS acl FROM pg_default_acl d
        WHERE d.defaclrole = 'lumbung_owner'::regrole AND d.defaclobjtype = 'f' AND d.defaclnamespace = 0`,
    );
    expect(defaults).toHaveLength(1);
    // Only the owner itself keeps EXECUTE; no "=X/" (PUBLIC) entry.
    expect((defaults[0].acl ?? []).some((a) => a.startsWith('=X'))).toBe(false);

    // Prove it: a fresh function created by the owner is not PUBLIC-executable.
    await owner.query('BEGIN');
    try {
      await owner.query('CREATE FUNCTION lumbung.zz_default_acl_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$');
      const [{ pub }] = (
        await owner.query<{ pub: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_proc p
                   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = 'lumbung.zz_default_acl_probe()'::regprocedure
                     AND a.grantee = 0) AS pub`,
        )
      ).rows;
      expect(pub).toBe(false);
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});

describe('roles', () => {
  it('lumbung_app is not superuser, bypassrls, owner of anything, or a member of the owner', async () => {
    const [app] = await rows<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      member_of_owner: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
              pg_has_role('lumbung_app', 'lumbung_owner', 'MEMBER') AS member_of_owner
         FROM pg_roles WHERE rolname = 'lumbung_app'`,
    );
    expect(app).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      member_of_owner: false,
    });

    const owned = await rows<{ kind: string; name: string }>(
      `SELECT 'relation' AS kind, c.relname AS name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND c.relowner = 'lumbung_app'::regrole
       UNION ALL
       SELECT 'function', p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'lumbung' AND p.proowner = 'lumbung_app'::regrole
       UNION ALL
       SELECT 'schema', nspname FROM pg_namespace WHERE nspowner = 'lumbung_app'::regrole
       UNION ALL
       SELECT 'database', datname FROM pg_database WHERE datdba = 'lumbung_app'::regrole`,
    );
    expect(owned).toEqual([]);

    const [schema] = await rows<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege('lumbung_app', 'lumbung', 'USAGE') AS usage,
              has_schema_privilege('lumbung_app', 'lumbung', 'CREATE') AS create`,
    );
    expect(schema).toEqual({ usage: true, create: false });
  });
});
