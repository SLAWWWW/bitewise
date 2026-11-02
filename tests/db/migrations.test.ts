/**
 * Migration runner + bootstrap contract (W1-DB):
 *  - a fresh database migrates cleanly and records every file
 *  - re-running is a no-op; concurrent runners apply each file once
 *  - an edited / missing applied migration is refused (checksum guard)
 *  - bootstrap is idempotent and the roles have the required attributes
 *  - portability lint: no roles/extensions in migrations, everything in schema lumbung
 *  - smoke for verify_tenant_invariants / demo_reset_begin
 *
 * Uses the cluster of the shared global setup (TEST_DATABASE_ADMIN_URL via
 * inject), else DATABASE_ADMIN_URL / the dev default, otherwise starts a
 * private embedded instance (needs its own databases to test fresh migration). Every database created here is uniquely named
 * and dropped afterwards.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  DEFAULT_ADMIN_URL,
  bootstrapCluster,
  createDatabase,
  createMigratedDatabase,
  dropDatabase,
  readMigrationFiles,
  runMigrations,
  urlWith,
  type ScratchDatabase,
} from '@/src/db/migrate-lib';
import { ensureCluster, type ClusterHandle } from '@/scripts/db/start';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

/** Value provided by tests/setup/global-db.ts, or undefined when run without it. */
function provided(key: 'TEST_DATABASE_ADMIN_URL' | 'TEST_DATABASE_OWNER_URL'): string | undefined {
  try {
    return (inject as (k: string) => string | undefined)(key) ?? process.env[key];
  } catch {
    return process.env[key];
  }
}

function adminCandidates(): Array<string | undefined> {
  const shared = provided('TEST_DATABASE_OWNER_URL');
  return [
    provided('TEST_DATABASE_ADMIN_URL'),
    shared ? urlWith(shared, { user: 'postgres', password: 'postgres', database: 'postgres' }) : undefined,
    process.env.DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL,
  ];
}

const uniqueName = (tag: string) => `lumbung_t_${tag}_${process.pid}_${randomBytes(3).toString('hex')}`;

async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  url: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

let cluster: ClusterHandle;
const created: string[] = [];
const tmpDirs: string[] = [];

async function freshDb(tag: string): Promise<ScratchDatabase> {
  const name = uniqueName(tag);
  created.push(name);
  return createMigratedDatabase(cluster.adminUrl, name);
}

beforeAll(async () => {
  cluster = await ensureCluster(adminCandidates(), { dirPrefix: 'pg-dbtest-migrations' });
}, 120_000);

afterAll(async () => {
  if (cluster) {
    for (const name of created) await dropDatabase(cluster.adminUrl, name).catch(() => undefined);
    await cluster.stop();
  }
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
}, 120_000);

describe('migration runner', () => {
  it('migrates a fresh database cleanly and records every file with its checksum', async () => {
    const files = readMigrationFiles(MIGRATIONS_DIR);
    expect(files.map((f) => f.name).slice(0, 12)).toEqual([
      '0001_schema_helpers.sql',
      '0002_tenancy_security.sql',
      '0003_reference.sql',
      '0004_flo.sql',
      '0005_agreements.sql',
      '0006_donors_sources_media.sql',
      '0007_donations_allocation.sql',
      '0008_delivery_receipts.sql',
      '0009_inventory.sql',
      '0010_reporting_comms_jobs.sql',
      '0011_integration.sql',
      '0012_rls_grants.sql',
    ]);

    const db = await freshDb('fresh');
    expect(db.applied).toEqual(files.map((f) => f.name));

    const rows = await query<{ version: number; name: string; checksum: string }>(
      db.ownerUrl,
      'SELECT version, name, checksum FROM lumbung.schema_migrations ORDER BY version',
    );
    expect(rows).toEqual(files.map((f) => ({ version: f.version, name: f.name, checksum: f.checksum })));

    // Everything in the schema belongs to lumbung_owner.
    const notOwned = await query(
      db.ownerUrl,
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND pg_get_userbyid(c.relowner) <> 'lumbung_owner'
       UNION ALL
       SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'lumbung' AND pg_get_userbyid(p.proowner) <> 'lumbung_owner'
       UNION ALL
       SELECT nspname FROM pg_namespace WHERE nspname = 'lumbung' AND pg_get_userbyid(nspowner) <> 'lumbung_owner'`,
    );
    expect(notOwned).toEqual([]);

    // Database is locked down and per-role search_path / UTC are set.
    const [dbRow] = await query<{ owner: string; public_connect: boolean; app_connect: boolean }>(
      db.adminUrl,
      `SELECT pg_get_userbyid(datdba) AS owner,
              has_database_privilege('public', datname, 'CONNECT') AS public_connect,
              has_database_privilege('lumbung_app', datname, 'CONNECT') AS app_connect
         FROM pg_database WHERE datname = $1`,
      [db.dbName],
    );
    expect(dbRow).toEqual({ owner: 'lumbung_owner', public_connect: false, app_connect: true });
    const [settings] = await query<{ search_path: string; tz: string }>(
      db.appUrl,
      `SELECT current_setting('search_path') AS search_path, current_setting('TimeZone') AS tz`,
    );
    expect(settings).toEqual({ search_path: 'lumbung, pg_temp', tz: 'UTC' });
  }, 120_000);

  it('is a no-op when re-run, and concurrent runners apply each file exactly once', async () => {
    const db = await freshDb('rerun');
    expect(await runMigrations(db.ownerUrl)).toEqual([]);

    // Concurrent runners on a brand-new database serialise on the advisory lock.
    const name = uniqueName('concurrent');
    created.push(name);
    await createDatabase(cluster.adminUrl, name);
    const ownerUrl = urlWith(cluster.adminUrl, { database: name, user: 'lumbung_owner', password: 'lumbung_owner' });
    const [a, b] = await Promise.all([runMigrations(ownerUrl), runMigrations(ownerUrl)]);
    const total = readMigrationFiles(MIGRATIONS_DIR).length;
    expect(a.length + b.length).toBe(total);
    expect(new Set([...a, ...b]).size).toBe(total);
    const [{ n }] = await query<{ n: number }>(ownerUrl, 'SELECT count(*)::int AS n FROM lumbung.schema_migrations');
    expect(n).toBe(total);
  }, 120_000);

  it('refuses an edited or missing applied migration and applies new files', async () => {
    const db = await freshDb('checksum');
    const dir = path.join(process.cwd(), '.data', `migrations-copy-${process.pid}-${randomBytes(3).toString('hex')}`);
    tmpDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });

    // A new file is applied (and only it).
    writeFileSync(
      path.join(dir, '9999_test_extra.sql'),
      'CREATE TABLE lumbung.zz_runner_probe (id integer PRIMARY KEY);\n',
    );
    expect(await runMigrations(db.ownerUrl, { migrationsDir: dir })).toEqual(['9999_test_extra.sql']);

    // Editing an applied file (even whitespace/comment) is refused.
    const target = path.join(dir, '0003_reference.sql');
    const original = readFileSync(target);
    appendFileSync(target, '\n-- edited after being applied\n');
    await expect(runMigrations(db.ownerUrl, { migrationsDir: dir })).rejects.toThrow(
      /Checksum mismatch for applied migration 0003_reference\.sql/,
    );
    writeFileSync(target, original);
    expect(await runMigrations(db.ownerUrl, { migrationsDir: dir })).toEqual([]);

    // Deleting an applied file is refused.
    unlinkSync(path.join(dir, '9999_test_extra.sql'));
    await expect(runMigrations(db.ownerUrl, { migrationsDir: dir })).rejects.toThrow(/missing/);

    // A failing migration rolls back completely and is not recorded.
    const bad = uniqueName('bad');
    created.push(bad);
    await createDatabase(cluster.adminUrl, bad);
    const badOwner = urlWith(cluster.adminUrl, { database: bad, user: 'lumbung_owner', password: 'lumbung_owner' });
    const badDir = path.join(process.cwd(), '.data', `migrations-bad-${process.pid}-${randomBytes(3).toString('hex')}`);
    tmpDirs.push(badDir);
    mkdirSync(badDir, { recursive: true });
    writeFileSync(path.join(badDir, '0001_ok.sql'), 'CREATE TABLE lumbung.ok_probe (id int);\n');
    writeFileSync(
      path.join(badDir, '0002_broken.sql'),
      'CREATE TABLE lumbung.half_probe (id int);\nSELECT * FROM lumbung.does_not_exist;\n',
    );
    await expect(runMigrations(badOwner, { migrationsDir: badDir })).rejects.toThrow(/0002_broken\.sql failed/);
    const tables = await query<{ relname: string }>(
      badOwner,
      `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND relname LIKE '%probe' ORDER BY 1`,
    );
    expect(tables.map((t) => t.relname)).toEqual(['ok_probe']);
    const recorded = await query<{ name: string }>(badOwner, 'SELECT name FROM lumbung.schema_migrations');
    expect(recorded.map((r) => r.name)).toEqual(['0001_ok.sql']);
  }, 120_000);
});

describe('cluster bootstrap', () => {
  it('is idempotent (also concurrently) and creates correctly-attributed roles', async () => {
    await Promise.all([bootstrapCluster(cluster.adminUrl), bootstrapCluster(cluster.adminUrl)]);
    await bootstrapCluster(cluster.adminUrl);
    const roles = await query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolcanlogin: boolean;
    }>(
      cluster.adminUrl,
      `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
         FROM pg_roles WHERE rolname IN ('lumbung_owner','lumbung_app') ORDER BY rolname`,
    );
    expect(roles).toEqual([
      { rolname: 'lumbung_app', rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true },
      { rolname: 'lumbung_owner', rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true },
    ]);
    const [{ member }] = await query<{ member: boolean }>(
      cluster.adminUrl,
      `SELECT pg_has_role('lumbung_app', 'lumbung_owner', 'MEMBER') AS member`,
    );
    expect(member).toBe(false);
  }, 60_000);

  it('rejects unsafe database names', async () => {
    await expect(createDatabase(cluster.adminUrl, 'bad-name; drop')).rejects.toThrow(/Invalid database name/);
  });
});

describe('portability lint (Supabase PG17)', () => {
  const files = readMigrationFiles(MIGRATIONS_DIR);

  it('never creates roles, users, extensions or databases in migrations', () => {
    for (const f of files) {
      expect(f.sql, f.name).not.toMatch(/\bCREATE\s+(ROLE|USER|EXTENSION|DATABASE)\b/i);
      expect(f.sql, f.name).not.toMatch(/\bALTER\s+SYSTEM\b/i);
    }
  });

  it('schema-qualifies every created object with lumbung.', () => {
    const creates = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(TABLE|FUNCTION|VIEW|TYPE|PROCEDURE|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi;
    for (const f of files) {
      for (const m of f.sql.matchAll(creates)) {
        expect(m[2], `${f.name}: CREATE ${m[1]} ${m[2]}`).toMatch(/^lumbung\./);
      }
    }
  });
});

describe('schema helpers smoke', () => {
  it('verify_tenant_invariants flags a DEMO tenant without a clock and demo_reset_begin removes it', async () => {
    const db = await freshDb('invariants');
    const c = new pg.Client({ connectionString: db.ownerUrl });
    await c.connect();
    try {
      const tenant = randomUUID();
      const slug = `inv-${randomBytes(4).toString('hex')}`;
      await c.query(`INSERT INTO lumbung.tenants (id, slug, name, mode, is_demo) VALUES ($1, $2, 'Invariant probe', 'DEMO', true)`, [
        tenant,
        slug,
      ]);
      const before = await c.query('SELECT code FROM lumbung.verify_tenant_invariants($1)', [tenant]);
      expect(before.rows.map((r) => r.code)).toEqual(['CLOCK_MISSING']);

      await c.query(
        `INSERT INTO lumbung.tenant_clocks (tenant_id, mode, sim_anchor) VALUES ($1, 'FROZEN', '2026-10-26T01:00:00Z')`,
        [tenant],
      );
      expect((await c.query('SELECT * FROM lumbung.verify_tenant_invariants($1)', [tenant])).rows).toEqual([]);

      await c.query(
        `INSERT INTO lumbung.audit_events (tenant_id, actor_kind, action, subject_type, occurred_at)
         VALUES ($1, 'SYSTEM', 'probe', 'TENANT', '2026-10-26T01:00:00Z')`,
        [tenant],
      );
      await c.query('BEGIN');
      const reset = await c.query('SELECT lumbung.demo_reset_begin($1) AS id', [slug]);
      await c.query('COMMIT');
      expect(reset.rows[0].id).toBe(tenant);
      const left = await c.query(
        `SELECT (SELECT count(*) FROM lumbung.tenants WHERE id = $1)::int AS t,
                (SELECT count(*) FROM lumbung.audit_events WHERE tenant_id = $1)::int AS a`,
        [tenant],
      );
      expect(left.rows[0]).toEqual({ t: 0, a: 0 });
      // Unknown slug is a no-op.
      expect((await c.query('SELECT lumbung.demo_reset_begin($1) AS id', ['no-such-tenant'])).rows[0].id).toBeNull();
    } finally {
      await c.end();
    }
  }, 120_000);

  it('verify_tenant_invariants reports each S1 violation class; the ledger rejects unbalanced movements', async () => {
    const db = await freshDb('violations');
    const c = new pg.Client({ connectionString: db.ownerUrl });
    await c.connect();
    const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0]?.id as string;
    try {
      await c.query('BEGIN');
      const T = await one(`INSERT INTO lumbung.tenants (slug, name, mode, is_demo) VALUES ('viol-probe', 'P', 'DEMO', true) RETURNING id`);
      await c.query(`INSERT INTO lumbung.tenant_clocks (tenant_id, mode, sim_anchor) VALUES ($1, 'FROZEN', '2026-10-26T01:00:00Z')`, [T]);
      const U = await one(`INSERT INTO lumbung.users (display_name) VALUES ('Peninjau') RETURNING id`);
      const cat = await one(
        `INSERT INTO lumbung.categories (tenant_id, code, name_id, name_en, comparable_unit, perishability)
         VALUES ($1, 'BREAD', 'Roti', 'Bread', 'portion', 'HIGH') RETURNING id`, [T]);
      const prod = await one(
        `INSERT INTO lumbung.products (tenant_id, code, name, category_id, base_unit, unit_kind, storage_profile)
         VALUES ($1, 'ROTI', 'Roti Tawar', $2, 'portion', 'COUNT', 'AMBIENT') RETURNING id`, [T, cat]);
      const flo = await one(
        `INSERT INTO lumbung.flos (tenant_id, code, name, flo_type, service_model, area, tenure)
         VALUES ($1, 'FLO-0001', 'Panti', 'PANTI', 'RESIDENTIAL', 'JAKARTA', 'NEW') RETURNING id`, [T]);
      // Interval stored as UTC midnight instead of WIB midnight (2025-12-31T17:00Z).
      await c.query(
        `INSERT INTO lumbung.agreements (tenant_id, flo_id, valid_from_date, valid_through_date, valid_from,
                                         valid_until_exclusive, review_state, reviewer_id, reviewed_at)
         VALUES ($1, $2, '2026-01-01', '2026-01-31', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'APPROVED', $3, now())`,
        [T, flo, U]);
      const donor = await one(`INSERT INTO lumbung.donors (tenant_id, code, name, kind) VALUES ($1, 'D1', 'Toko', 'BAKERY') RETURNING id`, [T]);
      const site = await one(
        `INSERT INTO lumbung.source_locations (tenant_id, code, donor_id, kind) VALUES ($1, 'S1', $2, 'DONOR_SITE') RETURNING id`, [T, donor]);
      const ord = await one(
        `INSERT INTO lumbung.donation_orders (tenant_id, code, donor_id, source_location_id, route, intake_channel)
         VALUES ($1, 'ORD-1', $2, $3, 'DIRECT', 'MANUAL') RETURNING id`, [T, donor, site]);
      const item = await one(
        `INSERT INTO lumbung.donation_items (tenant_id, order_id, line_no, product_id, category_id, quantity, unit, unit_kind)
         VALUES ($1, $2, 1, $3, $4, 10, 'portion', 'COUNT') RETURNING id`, [T, ord, prod, cat]);
      const alloc = await one(
        `INSERT INTO lumbung.allocations (tenant_id, code, item_id, source_type, flo_id, category_id, quantity, unit, unit_kind)
         VALUES ($1, 'ALC-1', $2, 'DIRECT_ITEM', $3, $4, 12, 'portion', 'COUNT') RETURNING id`, [T, item, flo, cat]);
      // A non-MANUAL_ALLOCATION approval does not count as a manual trace.
      const appr = await one(
        `INSERT INTO lumbung.approvals (tenant_id, stage, subject_type, subject_id, subject_revision, input_hash, approver_id, approved_at)
         VALUES ($1, 'POLICY', 'ALLOCATION', $2, 1, 'h', $3, now()) RETURNING id`, [T, alloc, U]);
      await c.query(`UPDATE lumbung.allocations SET state = 'RECEIVED', manual_approval_id = $2 WHERE id = $1`, [alloc, appr]);
      const res = await one(
        `INSERT INTO lumbung.reservations (tenant_id, kind, source_type, allocation_id, state)
         VALUES ($1, 'RESERVATION', 'DIRECT_ITEM', $2, 'CONSUMED') RETURNING id`, [T, alloc]);
      await c.query(
        `INSERT INTO lumbung.reservation_lines (tenant_id, reservation_id, item_id, quantity, unit, state)
         VALUES ($1, $2, $3, 12, 'portion', 'CONSUMED')`, [T, res, item]);
      const dlv = await one(
        `INSERT INTO lumbung.deliveries (tenant_id, code, route, source_location_id, destination_flo_id, state, dispatched_at, received_at)
         VALUES ($1, 'DLV-1', 'DIRECT', $2, $3, 'RECEIVED', '2026-10-20T01:00:00Z', '2026-10-20T03:00:00Z') RETURNING id`,
        [T, site, flo]);
      const dl = await one(
        `INSERT INTO lumbung.delivery_lines (tenant_id, delivery_id, allocation_id, item_id, category_id, unit, unit_kind, allocated_qty, dispatched_qty)
         VALUES ($1, $2, $3, $4, $5, 'portion', 'COUNT', 12, 10) RETURNING id`, [T, dlv, alloc, item, cat]);
      const rc = await one(
        `INSERT INTO lumbung.flo_receipts (tenant_id, delivery_id, flo_id, received_at, time_source)
         VALUES ($1, $2, $3, '2026-10-20T03:00:00Z', 'REPORTED') RETURNING id`, [T, dlv, flo]);
      await c.query(
        `INSERT INTO lumbung.receipt_lines (tenant_id, receipt_id, delivery_line_id, flo_id, category_id, unit, received_at,
                                            accepted_qty, rejected_qty, discrepancy_reason)
         VALUES ($1, $2, $3, $4, $5, 'portion', '2026-10-20T03:00:00Z', 10, 1, 'rusak')`, [T, rc, dl, flo, cat]);
      const batch = await one(
        `INSERT INTO lumbung.inventory_batches (tenant_id, batch_code, product_id, category_id, donor_order_id, base_unit, unit_kind, received_at)
         VALUES ($1, 'B-1', $2, $3, $4, 'portion', 'COUNT', '2026-10-20T00:00:00Z') RETURNING id`, [T, prod, cat, ord]);
      const mv = await one(
        `INSERT INTO lumbung.stock_movements (tenant_id, command_id, type, occurred_at)
         VALUES ($1, 'cmd-1', 'RECEIPT', '2026-10-20T00:00:00Z') RETURNING id`, [T]);
      await c.query(
        `INSERT INTO lumbung.movement_entries (tenant_id, movement_id, batch_id, account, signed_qty)
         VALUES ($1, $2, $3, 'EXTERNAL_RECEIPT', -5), ($1, $2, $3, 'AVAILABLE', 5)`, [T, mv, batch]);
      await c.query(
        `INSERT INTO lumbung.batch_balances (tenant_id, batch_id, account, qty)
         VALUES ($1, $2, 'AVAILABLE', 4), ($1, $2, 'EXTERNAL_RECEIPT', -5)`, [T, batch]);
      await c.query(
        `INSERT INTO lumbung.seed_manifests (tenant_id, seed, clock, schema_version, counts)
         VALUES ($1, 20261026, '2026-10-26T01:00:00Z', 12, '{}')`, [T]);

      const { rows } = await c.query<{ code: string; subject_type: string }>(
        'SELECT code, subject_type FROM lumbung.verify_tenant_invariants($1) ORDER BY 1, 2', [T]);
      expect(rows.map((r) => `${r.code}:${r.subject_type}`)).toEqual([
        'AGREEMENT_INTERVAL_MISMATCH:AGREEMENT',
        'BALANCE_MISMATCH:BATCH',
        'DIRECT_ROUTE_STOCK:BATCH',
        'DISPATCH_AGREEMENT_INVALID:DELIVERY',
        'FINAL_APPROVAL_MISSING:ALLOCATION',
        'HANDOVER_AGREEMENT_INVALID:FLO_RECEIPT',
        'ITEM_OVERCOMMITTED:DONATION_ITEM',
        'NEW_FLO_HAS_HISTORY:FLO',
        'OUTREACH_TRACE_MISSING:ALLOCATION',
        'RECEIPT_EXCEEDS_DISPATCHED:DELIVERY_LINE',
        'RECEIPT_OBLIGATION_MISSING:FLO_RECEIPT',
        'RECEIPT_OBLIGATION_MISSING:FLO_RECEIPT',
      ]);

      // Derived batch status reads the balances.
      const status = await c.query(`SELECT status, available_qty FROM lumbung.v_batch_status WHERE batch_id = $1`, [batch]);
      expect(status.rows).toEqual([{ status: 'AVAILABLE', available_qty: '4.000' }]);

      // An unbalanced movement is rejected when the deferred trigger fires.
      await c.query(
        `INSERT INTO lumbung.movement_entries (tenant_id, movement_id, batch_id, account, signed_qty)
         VALUES ($1, $2, $3, 'AVAILABLE', 1)`, [T, mv, batch]);
      await expect(c.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toThrow('LB:LEDGER_UNBALANCED');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
  }, 120_000);
});
