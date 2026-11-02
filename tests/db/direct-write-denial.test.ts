/**
 * AC41 direct-write denial + tenant isolation basics (W1-DB).
 *
 *  - The exact set of tables lumbung_app can write is the documented allowlist
 *    (catalog: has_table_privilege / has_any_column_privilege); DELETE and
 *    TRUNCATE are granted nowhere.
 *  - As lumbung_app with a VALID tenant context, INSERT / UPDATE / DELETE on
 *    every protected table fails with 42501 (approvals, agreement review
 *    fields, allocations, offers, reservations, ledger, receipts, audit,
 *    obligations, outbox, jobs, memberships, clocks, policies, ...).
 *  - Append-only: UPDATE / DELETE / TRUNCATE on audit_events, domain_events
 *    and the stock ledger are blocked by trigger even for the owner.
 *  - Cross-tenant: tenant A rows are invisible under tenant B; with NO context
 *    nothing is visible (fail closed); RLS WITH CHECK blocks foreign tenant_id.
 *  - Context guards: require_ctx / require_cap / tenant_now behaviour.
 */
import { randomBytes, randomUUID } from 'node:crypto';
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

// Tables lumbung_app may write directly (RLS-checked, column lists where mixed).
const WRITABLE: Record<string, { insert: boolean; update: boolean }> = {
  availability_windows: { insert: true, update: true },
  category_demands: { insert: true, update: false },
  expected_inbounds: { insert: true, update: false },
  flo_clusters: { insert: true, update: true },
  flo_contacts: { insert: true, update: true },
  flos: { insert: true, update: true },
  inbound_lines: { insert: true, update: false },
  messages: { insert: true, update: false },
  need_assessments: { insert: true, update: false },
  service_schedules: { insert: true, update: true },
  tasks: { insert: true, update: true },
};

// AC41 protected list (architecture A.1 0012 "No DML" + task brief).
const PROTECTED = [
  'media_files','import_rows','import_runs','receipt_correction_requests',
  'donation_orders',
  'donation_items',
  'allocation_runs',
  'approvals',
  'agreements',
  'renewal_tasks',
  'allocations',
  'offers',
  'reservations',
  'reservation_lines',
  'transport_arrangements',
  'deliveries',
  'delivery_lines',
  'flo_receipts',
  'receipt_lines',
  'inventory_batches',
  'stock_movements',
  'movement_entries',
  'batch_balances',
  'inspections',
  'inspection_lines',
  'stock_adjustment_requests',
  'evidence_obligations',
  'evidence_submissions',
  'evidence_reviews',
  'submission_files',
  'distribution_events',
  'distribution_event_lines',
  'audit_events',
  'domain_events',
  'outbox',
  'jobs',
  'webhook_events',
  'external_mappings',
  'tenant_clocks',
  'policy_versions',
  'tenant_active_policies',
  'activation_decisions',
  'memberships',
  'idempotency_keys',
  'flo_access_links',
  'seed_manifests',
] as const;

interface Ctx {
  tenantId: string;
  userId?: string | null;
  actorKind: 'USER' | 'WORKER' | 'AGENT' | 'FLO_LINK' | 'SYSTEM';
  linkId?: string | null;
}

interface Fixture {
  tenantId: string;
  slug: string;
  coordinatorId: string;
  auditorId: string;
  floIds: string[];
  categoryId: string;
  taskId: string;
  agreementId: string;
  linkId: string;
  expiredLinkId: string;
}

let ownerUrl: string;
let appUrl: string;
let owner: pg.Client;
let privateCluster: ClusterHandle | null = null;
let privateDb: ScratchDatabase | null = null;
let A: Fixture;
let B: Fixture;

const SEED_INSTANT = '2026-10-26T01:00:00.000Z';
const COORDINATOR_CAPS = [
  'flo.read', 'flo.edit', 'need.propose', 'need.confirm', 'donation.create', 'donation.validate',
  'allocation.run', 'outreach.approve', 'campaign.start', 'offer.respond', 'transport.edit',
  'dispatch.approve', 'delivery.dispatch', 'delivery.receive', 'reservation.release', 'receipt.correct',
  'evidence.submit', 'conversation.takeover', 'message.send', 'audit.read', 'demo.clock',
];
const hex64 = () => randomBytes(32).toString('hex');

async function makeFixture(label: string): Promise<Fixture> {
  const f: Fixture = {
    tenantId: randomUUID(),
    slug: `dwd-${label}-${randomBytes(4).toString('hex')}`,
    coordinatorId: randomUUID(),
    auditorId: randomUUID(),
    floIds: [randomUUID(), randomUUID()],
    categoryId: randomUUID(),
    taskId: randomUUID(),
    agreementId: randomUUID(),
    linkId: randomUUID(),
    expiredLinkId: randomUUID(),
  };
  await owner.query('BEGIN');
  try {
    await owner.query(
      `INSERT INTO lumbung.tenants (id, slug, name, mode, is_demo) VALUES ($1, $2, $3, 'TEST', true)`,
      [f.tenantId, f.slug, `Tenant ${label}`],
    );
    await owner.query(`INSERT INTO lumbung.tenant_clocks (tenant_id, mode, sim_anchor) VALUES ($1, 'FROZEN', $2)`, [
      f.tenantId,
      SEED_INSTANT,
    ]);
    for (const [id, name, caps] of [
      [f.coordinatorId, `Koordinator ${label}`, COORDINATOR_CAPS],
      [f.auditorId, `Auditor ${label}`, ['flo.read', 'audit.read']],
    ] as const) {
      await owner.query(`INSERT INTO lumbung.users (id, display_name, email) VALUES ($1, $2, $3)`, [
        id,
        name,
        `${id}@example.invalid`,
      ]);
      await owner.query(
        `INSERT INTO lumbung.memberships (tenant_id, user_id, role_label, capabilities) VALUES ($1, $2, 'TEST', $3::text[])`,
        [f.tenantId, id, caps],
      );
    }
    await owner.query(
      `INSERT INTO lumbung.categories (id, tenant_id, code, name_id, name_en, comparable_unit, perishability)
       VALUES ($1, $2, 'BREAD', 'Roti', 'Bread', 'portion', 'HIGH')`,
      [f.categoryId, f.tenantId],
    );
    for (const [i, floId] of f.floIds.entries()) {
      await owner.query(
        `INSERT INTO lumbung.flos (id, tenant_id, code, name, flo_type, service_model, area)
         VALUES ($1, $2, $3, $4, 'PANTI', 'RESIDENTIAL', 'JAKARTA')`,
        [floId, f.tenantId, `FLO-${String(i + 1).padStart(4, '0')}`, `Panti Uji ${label} ${i + 1}`],
      );
    }
    await owner.query(
      `INSERT INTO lumbung.tasks (id, tenant_id, kind, subject_type, subject_id) VALUES ($1, $2, 'PROBE', 'FLO', $3)`,
      [f.taskId, f.tenantId, f.floIds[0]],
    );
    await owner.query(
      `INSERT INTO lumbung.agreements (id, tenant_id, flo_id, valid_from_date, valid_through_date, valid_from, valid_until_exclusive)
       VALUES ($1, $2, $3, '2026-01-01', '2026-12-31', '2025-12-31T17:00:00Z', '2026-12-31T17:00:00Z')`,
      [f.agreementId, f.tenantId, f.floIds[0]],
    );
    await owner.query(
      `INSERT INTO lumbung.audit_events (tenant_id, actor_id, actor_kind, action, subject_type, subject_id, occurred_at)
       VALUES ($1, $2, 'USER', 'probe.created', 'FLO', $3, $4)`,
      [f.tenantId, f.coordinatorId, f.floIds[0], SEED_INSTANT],
    );
    await owner.query(
      `INSERT INTO lumbung.flo_access_links (id, tenant_id, flo_id, subject_type, actions, token_hash, expires_at)
       VALUES ($1, $2, $3, 'OFFER', '{offer.respond}', $4, '2026-10-27T00:00:00Z'),
              ($5, $2, $3, 'OFFER', '{offer.respond}', $6, '2026-10-25T00:00:00Z')`,
      [f.linkId, f.tenantId, f.floIds[0], hex64(), f.expiredLinkId, hex64()],
    );
    await owner.query('COMMIT');
  } catch (e) {
    await owner.query('ROLLBACK');
    throw e;
  }
  return f;
}

/** Run fn as lumbung_app inside a transaction (always rolled back). */
async function asApp<T>(ctx: Ctx | null, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: appUrl });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (ctx) {
      await c.query(
        `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true),
                set_config('app.actor_kind', $3, true), set_config('app.link_id', $4, true),
                set_config('app.correlation_id', $5, true)`,
        [ctx.tenantId, ctx.userId ?? '', ctx.actorKind, ctx.linkId ?? '', randomUUID()],
      );
    }
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

/** Execute inside a savepoint and return the SQLSTATE + message (or null on success). */
async function attempt(
  c: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string; message: string } | null> {
  await c.query('SAVEPOINT probe');
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? '?', message: err.message ?? '' };
  } finally {
    await c.query('ROLLBACK TO SAVEPOINT probe');
  }
}

const coordinator = (f: Fixture): Ctx => ({ tenantId: f.tenantId, userId: f.coordinatorId, actorKind: 'USER' });

beforeAll(async () => {
  ownerUrl = provided('TEST_DATABASE_OWNER_URL') ?? '';
  appUrl = provided('TEST_DATABASE_URL') ?? '';
  if (!ownerUrl || !appUrl) {
    privateCluster = await ensureCluster(
      [process.env.TEST_DATABASE_ADMIN_URL, process.env.DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL],
      { dirPrefix: 'pg-dbtest-dwd' },
    );
    privateDb = await createMigratedDatabase(
      privateCluster.adminUrl,
      `lumbung_t_dwd_${process.pid}_${randomBytes(3).toString('hex')}`,
    );
    ownerUrl = privateDb.ownerUrl;
    appUrl = privateDb.appUrl;
  }
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  A = await makeFixture('a');
  B = await makeFixture('b');
}, 120_000);

afterAll(async () => {
  if (owner) {
    // Remove our tenants (cascade, through the protected reset path).
    for (const f of [A, B]) {
      if (!f) continue;
      await owner.query('BEGIN');
      await owner.query('SELECT lumbung.demo_reset_begin($1)', [f.slug]);
      await owner.query('COMMIT');
    }
    await owner.query(`DELETE FROM lumbung.users WHERE email LIKE '%@example.invalid' AND id = ANY($1::uuid[])`, [
      [A?.coordinatorId, A?.auditorId, B?.coordinatorId, B?.auditorId].filter(Boolean),
    ]);
    await owner.end();
  }
  await privateDb?.drop();
  await privateCluster?.stop();
}, 120_000);

describe('AC41 grants catalog', () => {
  it('lets lumbung_app write exactly the documented allowlist and DELETE/TRUNCATE nothing', async () => {
    const { rows } = await owner.query<{ relname: string; ins: boolean; upd: boolean; del: boolean; trunc: boolean }>(
      `SELECT c.relname,
              has_any_column_privilege('lumbung_app', c.oid, 'INSERT') AS ins,
              has_any_column_privilege('lumbung_app', c.oid, 'UPDATE') AS upd,
              has_table_privilege('lumbung_app', c.oid, 'DELETE') AS del,
              has_table_privilege('lumbung_app', c.oid, 'TRUNCATE') AS trunc
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND c.relkind IN ('r','p','v')
        ORDER BY c.relname`,
    );
    const writable = Object.fromEntries(
      rows.filter((r) => r.ins || r.upd).map((r) => [r.relname, { insert: r.ins, update: r.upd }]),
    );
    expect(writable).toEqual(WRITABLE);
    expect(rows.filter((r) => r.del || r.trunc).map((r) => r.relname)).toEqual([]);
  });

  it('grants no INSERT/UPDATE privilege on any protected table (table or column level)', async () => {
    const { rows } = await owner.query<{ relname: string; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT t AS relname,
              has_any_column_privilege('lumbung_app', ('lumbung.' || t)::regclass, 'INSERT') AS ins,
              has_any_column_privilege('lumbung_app', ('lumbung.' || t)::regclass, 'UPDATE') AS upd,
              has_table_privilege('lumbung_app', ('lumbung.' || t)::regclass, 'DELETE') AS del
         FROM unnest($1::text[]) AS t`,
      [[...PROTECTED]],
    );
    expect(rows.filter((r) => r.ins || r.upd || r.del)).toEqual([]);
  });

  it('keeps protected columns out of mixed tables (state, revision, verification, confirmation)', async () => {
    const { rows } = await owner.query<{ col: string; ins: boolean; upd: boolean }>(
      `SELECT t || '.' || col AS col,
              has_column_privilege('lumbung_app', ('lumbung.' || t)::regclass, col, 'INSERT') AS ins,
              has_column_privilege('lumbung_app', ('lumbung.' || t)::regclass, col, 'UPDATE') AS upd
         FROM (VALUES ('donation_orders','operational_state'), ('donation_orders','revision'),
                      ('donation_orders','reporting_state'), ('donation_items','safety_state'),
                      ('donation_items','revision'), ('flos','tenure'), ('flos','revision'),
                      ('service_schedules','verified_count'), ('service_schedules','verified_by'),
                      ('category_demands','status'), ('category_demands','confirmed_by'),
                      ('need_assessments','status'), ('need_assessments','confirmed_by'),
                      ('expected_inbounds','state'), ('import_runs','state'), ('messages','approved_by'),
                      ('media_files','deletion_state'), ('media_files','duplicate_of_media_id'),
                      ('donation_orders','tenant_id'), ('flos','tenant_id'), ('tasks','tenant_id')) AS v(t, col)`,
    );
    // tenant_id is insertable on creatable tables but never updatable.
    const bad = rows.filter((r) => r.upd || (r.ins && !r.col.endsWith('.tenant_id')));
    expect(bad).toEqual([]);
  });
});

describe('AC41 live denial as lumbung_app with a valid tenant context', () => {
  it('denies INSERT / UPDATE / DELETE on every protected table with 42501', async () => {
    await asApp(coordinator(A), async (c) => {
      // Context is genuinely valid: the coordinator passes require_cap.
      await c.query(`SELECT lumbung.require_cap('dispatch.approve')`);
      const failures: string[] = [];
      for (const t of PROTECTED) {
        for (const [op, sql] of [
          ['INSERT', `INSERT INTO lumbung.${t} (tenant_id) VALUES ($1)`],
          ['UPDATE', `UPDATE lumbung.${t} SET tenant_id = tenant_id WHERE tenant_id = $1`],
          ['DELETE', `DELETE FROM lumbung.${t} WHERE tenant_id = $1`],
        ] as const) {
          const err = await attempt(c, sql, [A.tenantId]);
          if (err?.code !== '42501') failures.push(`${op} ${t}: ${err ? `${err.code} ${err.message}` : 'succeeded'}`);
        }
      }
      expect(failures).toEqual([]);
    });
  });

  it('denies approving an agreement by writing its review fields directly', async () => {
    await asApp(coordinator(A), async (c) => {
      const err = await attempt(
        c,
        `UPDATE lumbung.agreements SET review_state = 'APPROVED', reviewer_id = $2, reviewed_at = now() WHERE id = $1`,
        [A.agreementId, A.coordinatorId],
      );
      expect(err?.code).toBe('42501');
      const { rows } = await c.query(`SELECT review_state FROM lumbung.agreements WHERE id = $1`, [A.agreementId]);
      expect(rows).toEqual([{ review_state: 'PENDING_VERIFICATION' }]);
    });
  });

  it('denies setting protected columns on writable tables and inserting confirmed needs', async () => {
    await asApp(coordinator(A), async (c) => {
      expect((await attempt(c, `UPDATE lumbung.flos SET tenure = 'NEW' WHERE id = $1`, [A.floIds[0]]))?.code).toBe('42501');
      expect((await attempt(c, `UPDATE lumbung.flos SET revision = 99 WHERE id = $1`, [A.floIds[0]]))?.code).toBe('42501');
      expect(
        (
          await attempt(
            c,
            `INSERT INTO lumbung.need_assessments (tenant_id, flo_id, category_id, score, assessed_at, expires_at, status, confirmed_by)
             VALUES ($1, $2, $3, 90, $4, '2026-12-01T00:00:00Z', 'CONFIRMED', $5)`,
            [A.tenantId, A.floIds[0], A.categoryId, SEED_INSTANT, A.coordinatorId],
          )
        )?.code,
      ).toBe('42501');
      // The allowed path: a PROPOSED need (status defaults; confirmation is a command).
      const ok = await c.query(
        `INSERT INTO lumbung.need_assessments (tenant_id, flo_id, category_id, score, assessed_at, expires_at, assessor_id)
         VALUES ($1, $2, $3, 90, $4, '2026-12-01T00:00:00Z', $5) RETURNING status`,
        [A.tenantId, A.floIds[0], A.categoryId, SEED_INSTANT, A.coordinatorId],
      );
      expect(ok.rows).toEqual([{ status: 'PROPOSED' }]);
      // Profile edits are allowed and bump the revision via trigger.
      const upd = await c.query(`UPDATE lumbung.flos SET address = 'Jl. Uji 1' WHERE id = $1 RETURNING revision`, [
        A.floIds[0],
      ]);
      expect(upd.rows).toEqual([{ revision: 2 }]);
    });
  });

  it('cannot execute owner-only functions', async () => {
    await asApp(coordinator(A), async (c) => {
      expect((await attempt(c, `SELECT * FROM lumbung.verify_tenant_invariants($1)`, [A.tenantId]))?.code).toBe('42501');
      expect((await attempt(c, `SELECT lumbung.demo_reset_begin($1)`, [A.slug]))?.code).toBe('42501');
      expect((await attempt(c, `SELECT lumbung.apply_tenant_rls('lumbung.tasks'::regclass)`))?.code).toBe('42501');
    });
  });
});

describe('append-only trigger (even for the owner)', () => {
  it('blocks UPDATE / DELETE / TRUNCATE on audit_events and domain_events', async () => {
    const run = async (sql: string, params: unknown[] = []) => {
      await owner.query('BEGIN');
      try {
        await owner.query(sql, params);
        return null;
      } catch (e) {
        return (e as Error).message;
      } finally {
        await owner.query('ROLLBACK');
      }
    };
    await owner.query(
      `INSERT INTO lumbung.domain_events (tenant_id, type, object_type, object_id, occurred_at)
       VALUES ($1, 'PROBE', 'FLO', $2, $3)`,
      [A.tenantId, A.floIds[0], SEED_INSTANT],
    );
    for (const table of ['audit_events', 'domain_events']) {
      expect(await run(`UPDATE lumbung.${table} SET payload = '{"x":1}' WHERE tenant_id = $1`, [A.tenantId])).toBe(
        'LB:APPEND_ONLY',
      );
      expect(await run(`DELETE FROM lumbung.${table} WHERE tenant_id = $1`, [A.tenantId])).toBe('LB:APPEND_ONLY');
      expect(await run(`TRUNCATE lumbung.${table} CASCADE`)).toBe('LB:APPEND_ONLY');
      // Even with the escape hatch set for the row's own tenant, UPDATE stays blocked.
      await owner.query('BEGIN');
      try {
        await owner.query(`SELECT set_config('lumbung.reset_tenant', $1, true)`, [A.tenantId]);
        await expect(
          owner.query(`UPDATE lumbung.${table} SET payload = '{}' WHERE tenant_id = $1`, [A.tenantId]),
        ).rejects.toThrow('LB:APPEND_ONLY');
      } finally {
        await owner.query('ROLLBACK');
      }
    }
    // Escape hatch for a different tenant does not unlock A's rows.
    await owner.query('BEGIN');
    try {
      await owner.query(`SELECT set_config('lumbung.reset_tenant', $1, true)`, [B.tenantId]);
      await expect(owner.query(`DELETE FROM lumbung.audit_events WHERE tenant_id = $1`, [A.tenantId])).rejects.toThrow(
        'LB:APPEND_ONLY',
      );
    } finally {
      await owner.query('ROLLBACK');
    }
    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM lumbung.audit_events WHERE tenant_id = $1`, [
      A.tenantId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('refuses demo reset for LIVE tenants', async () => {
    const id = randomUUID();
    const slug = `live-${randomBytes(4).toString('hex')}`;
    await owner.query(`INSERT INTO lumbung.tenants (id, slug, name, mode, is_demo) VALUES ($1, $2, 'Live', 'LIVE', false)`, [
      id,
      slug,
    ]);
    try {
      await owner.query('BEGIN');
      await expect(owner.query('SELECT lumbung.demo_reset_begin($1)', [slug])).rejects.toThrow('LB:RESET_FORBIDDEN');
      await owner.query('ROLLBACK');
    } finally {
      await owner.query('DELETE FROM lumbung.tenants WHERE id = $1', [id]);
    }
  });
});

describe('tenant isolation (read paths, fail closed)', () => {
  async function selectableTenantTables(c: pg.Client): Promise<string[]> {
    const { rows } = await c.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND c.relkind IN ('r','p','v')
          AND has_table_privilege('lumbung_app', c.oid, 'SELECT')
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
        ORDER BY 1`,
    );
    return rows.map((r) => r.relname);
  }

  it('shows tenant A only its own rows and none of tenant B', async () => {
    await asApp(coordinator(A), async (c) => {
      const flos = await c.query(`SELECT id FROM lumbung.flos ORDER BY code`);
      expect(flos.rows.map((r) => r.id)).toEqual(A.floIds);
      const tenants = await c.query(`SELECT id FROM lumbung.tenants`);
      expect(tenants.rows).toEqual([{ id: A.tenantId }]);
      const users = await c.query(`SELECT id FROM lumbung.users ORDER BY id`);
      expect(users.rows.map((r) => r.id).sort()).toEqual([A.coordinatorId, A.auditorId].sort());

      const leaks: string[] = [];
      for (const t of await selectableTenantTables(c)) {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM lumbung.${t} WHERE tenant_id <> $1`, [A.tenantId]);
        if (rows[0].n !== 0) leaks.push(`${t}: ${rows[0].n}`);
      }
      expect(leaks).toEqual([]);
      const direct = await c.query(`SELECT count(*)::int AS n FROM lumbung.flos WHERE id = ANY($1::uuid[])`, [B.floIds]);
      expect(direct.rows[0].n).toBe(0);
    });
  });

  it('hides tenant A rows from tenant B', async () => {
    await asApp(coordinator(B), async (c) => {
      for (const [t, id] of [
        ['flos', A.floIds[0]],
        ['tasks', A.taskId],
        ['agreements', A.agreementId],
        ['categories', A.categoryId],
        ['users', A.coordinatorId],
        ['tenants', A.tenantId],
      ] as const) {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM lumbung.${t} WHERE id = $1`, [id]);
        expect(rows[0].n, t).toBe(0);
      }
      // Updates aimed at A's rows touch nothing.
      const upd = await c.query(`UPDATE lumbung.tasks SET state = 'DONE' WHERE id = $1`, [A.taskId]);
      expect(upd.rowCount).toBe(0);
    });
  });

  it('shows nothing at all without a tenant context', async () => {
    await asApp(null, async (c) => {
      const { rows } = await c.query(`SELECT lumbung.current_tenant() AS t`);
      expect(rows[0].t).toBeNull();
      const nonEmpty: string[] = [];
      for (const t of [...(await selectableTenantTables(c)), 'tenants', 'users']) {
        const r = await c.query(`SELECT count(*)::int AS n FROM lumbung.${t}`);
        if (r.rows[0].n !== 0) nonEmpty.push(`${t}: ${r.rows[0].n}`);
      }
      expect(nonEmpty).toEqual([]);
      const err = await attempt(c, `SELECT lumbung.tenant_now()`);
      expect(err?.message).toBe('LB:CONTEXT_REQUIRED');
      expect((await attempt(c, `SELECT lumbung.require_ctx()`))?.message).toBe('LB:CONTEXT_REQUIRED');
    });
  });

  it('rejects writes carrying another tenant id (RLS WITH CHECK)', async () => {
    await asApp(coordinator(A), async (c) => {
      const err = await attempt(c, `INSERT INTO lumbung.tasks (tenant_id, kind) VALUES ($1, 'PROBE')`, [B.tenantId]);
      expect(err?.code).toBe('42501');
      expect(err?.message).toMatch(/row-level security/);
      const ok = await c.query(`INSERT INTO lumbung.tasks (tenant_id, kind) VALUES ($1, 'PROBE') RETURNING state`, [
        A.tenantId,
      ]);
      expect(ok.rows).toEqual([{ state: 'OPEN' }]);
    });
  });
});

describe('context guards', () => {
  const capError = async (ctx: Ctx | null, cap: string) =>
    asApp(ctx, async (c) => (await attempt(c, `SELECT lumbung.require_cap($1)`, [cap]))?.message ?? 'OK');

  it('require_cap checks memberships, never a GUC', async () => {
    expect(await capError(coordinator(A), 'dispatch.approve')).toBe('OK');
    expect(await capError({ tenantId: A.tenantId, userId: A.auditorId, actorKind: 'USER' }, 'dispatch.approve')).toBe(
      'LB:FORBIDDEN',
    );
    // B's coordinator has no membership in A.
    expect(await capError({ tenantId: A.tenantId, userId: B.coordinatorId, actorKind: 'USER' }, 'flo.read')).toBe(
      'LB:FORBIDDEN',
    );
    expect(await capError(coordinator(A), 'nope.cap')).toBe('LB:UNKNOWN_CAPABILITY');
    expect(await capError(null, 'flo.read')).toBe('LB:CONTEXT_REQUIRED');
    expect(await capError({ tenantId: randomUUID(), userId: A.coordinatorId, actorKind: 'USER' }, 'flo.read')).toBe(
      'LB:CONTEXT_REQUIRED',
    );
  });

  it('WORKER / AGENT use a fixed allowlist without approval powers', async () => {
    const worker: Ctx = { tenantId: A.tenantId, actorKind: 'WORKER' };
    const agent: Ctx = { tenantId: A.tenantId, actorKind: 'AGENT' };
    expect(await capError(worker, 'message.send')).toBe('OK');
    for (const cap of [
      'agreement.review',
      'outreach.approve',
      'dispatch.approve',
      'inventory.quarantine_release',
      'need.confirm',
      'policy.manage',
      'evidence.excuse',
    ]) {
      expect(await capError(worker, cap), `WORKER ${cap}`).toBe('LB:FORBIDDEN');
      expect(await capError(agent, cap), `AGENT ${cap}`).toBe('LB:FORBIDDEN');
    }
  });

  it('FLO_LINK is limited to its own unexpired link actions (tenant clock)', async () => {
    const link = (linkId: string): Ctx => ({ tenantId: A.tenantId, actorKind: 'FLO_LINK', linkId });
    expect(await capError(link(A.linkId), 'offer.respond')).toBe('OK');
    expect(await capError(link(A.linkId), 'delivery.receive')).toBe('LB:FORBIDDEN');
    expect(await capError(link(A.expiredLinkId), 'offer.respond')).toBe('LB:FORBIDDEN');
    // B's link used under A's tenant context does not resolve.
    expect(await capError(link(B.linkId), 'offer.respond')).toBe('LB:FORBIDDEN');
    expect(await capError({ tenantId: A.tenantId, actorKind: 'FLO_LINK' }, 'offer.respond')).toBe(
      'LB:CONTEXT_REQUIRED',
    );
  });

  it('tenant_now() follows the FROZEN tenant clock, not the wall clock', async () => {
    await asApp(coordinator(A), async (c) => {
      const { rows } = await c.query(`SELECT lumbung.tenant_now() AS now`);
      expect((rows[0].now as Date).toISOString()).toBe(SEED_INSTANT);
    });
  });
});
