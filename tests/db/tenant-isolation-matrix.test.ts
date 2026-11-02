/**
 * AC40 tenant isolation matrix (Stage-1 surface, catalog-driven so later stages are
 * covered automatically).
 *
 *  1. READS: for EVERY relation in schema `lumbung` with a `tenant_id` column, as
 *     lumbung_app in tenant B's context, `count(*) WHERE tenant_id = A` is 0
 *     (or the relation is not readable by the app at all: 42501).
 *     Positive control: in A's context the app sees exactly the owner's count.
 *  2. FUNCTIONS: every SECURITY DEFINER function currently EXECUTE-able by lumbung_app,
 *     invoked with tenant-B contexts (and forged user/tenant pairs) against tenant A's
 *     ids, either fails or affects nothing: tenant A's data fingerprint (owner-side, all
 *     tenant tables) is unchanged and no result contains an A identifier.
 *     Positive control: the same argument vectors run as A's own user DO change A's
 *     data, so "affects nothing" is meaningful.
 *  3. NO CONTEXT: every app-readable relation returns zero rows, and SECURITY DEFINER
 *     functions fail (or return a non-leaking false).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTx } from '@/src/db/tx';
import type { DbCtx, TxClient } from '@/src/db/types';
import { CAPABILITIES } from '@/src/shared/capabilities';
import { ACTIVATION_DECISION_KEYS } from '@/src/shared/enums';
import { makeTenant, withOwner, type TestTenant } from '../setup/db-helpers';

/**
 * Functions exempt from the cross-tenant invocation rule, with the reason. Each still
 * gets a targeted assertion below.
 *  - demo_login_directory(): pre-login directory (W1-INFRA/W1-DB), intentionally
 *    context-free; restricted to DEMO/TEST demo tenants (never LIVE).
 */
const FUNCTION_ALLOWLIST: Record<string, string> = {
  demo_login_directory: 'pre-login demo directory; asserted to never expose LIVE tenants',
};

/** App-readable relations without tenant_id that are global by design. */
const GLOBAL_RELATIONS: Record<string, string> = {
  worker_heartbeats: 'global worker liveness (no tenant data), read-only USING (true)',
};

interface TenantData extends TestTenant {
  superUser: string;
  ids: Record<string, string>;
}

let A: TenantData;
let B: TenantData;
let C_LIVE: TestTenant;

interface Relation {
  relname: string;
  relkind: string;
  app_select: boolean;
  has_tenant_id: boolean;
}

interface SecDefFn {
  sig: string;
  proname: string;
  rettype: string;
  retset: boolean;
  in_types: string[];
  in_names: string[];
}

const hex64 = () => createHash('sha256').update(randomBytes(16)).digest('hex');

function appTx<T>(ctx: DbCtx, fn: (c: TxClient) => Promise<T>) {
  return withTx(ctx, fn, { retries: 0 });
}

function userCtx(tenantId: string | null, userId: string | null): DbCtx {
  return { tenantId, userId, actorKind: 'USER', correlationId: randomUUID() };
}

/** Give a tenant a user holding EVERY capability, so capability gates never mask a tenant-filter bug. */
async function addSuperUser(t: TestTenant): Promise<string> {
  const id = randomUUID();
  await withOwner(async (c) => {
    await c.query(`INSERT INTO lumbung.users (id, display_name, email, kind) VALUES ($1, $2, $3, 'HUMAN')`, [
      id,
      `Super ${t.slug}`,
      `super.${t.slug}@example.invalid`,
    ]);
    await c.query(
      `INSERT INTO lumbung.memberships (tenant_id, user_id, role_label, capabilities, status)
       VALUES ($1, $2, 'ADMIN+COORDINATOR', $3::text[], 'ACTIVE')`,
      [t.id, id, [...CAPABILITIES]],
    );
  });
  return id;
}

/** Owner-side fixture rows across the Stage-1 surface (security, FLO, agreements, audit). */
async function populate(t: TestTenant): Promise<Record<string, string>> {
  const ids: Record<string, string> = {
    category: randomUUID(),
    cluster: randomUUID(),
    flo: randomUUID(),
    flo2: randomUUID(),
    contact: randomUUID(),
    media: randomUUID(),
    agreementApproved: randomUUID(),
    agreementPending: randomUUID(),
    renewal: randomUUID(),
    need: randomUUID(),
    demand: randomUUID(),
    policy: randomUUID(),
    audit: randomUUID(),
    event: randomUUID(),
    task: randomUUID(),
    link: randomUUID(),
  };
  const reviewer = t.users.AGREEMENT_REVIEWER.id;
  const coord = t.users.COORDINATOR.id;
  await withOwner(async (c) => {
    const q = (sql: string, params: unknown[]) => c.query(sql, params);
    await q(
      `INSERT INTO lumbung.categories (id, tenant_id, code, name_id, name_en, comparable_unit, perishability)
       VALUES ($1, $2, 'BREAD', 'Roti', 'Bread', 'portion', 'HIGH')`,
      [ids.category, t.id],
    );
    await q(
      `INSERT INTO lumbung.clusters (id, tenant_id, code, name, area, lat, lng, radius_km)
       VALUES ($1, $2, 'JKT-SUNTER', 'Sunter (Demo)', 'JAKARTA', -6.14, 106.87, 3)`,
      [ids.cluster, t.id],
    );
    for (const [id, code] of [
      [ids.flo, 'FLO-0001'],
      [ids.flo2, 'FLO-0002'],
    ]) {
      await q(
        `INSERT INTO lumbung.flos (id, tenant_id, code, name, flo_type, service_model, area)
         VALUES ($1, $2, $3, $4, 'PANTI', 'DAILY', 'JAKARTA')`,
        [id, t.id, code, `Panti Simulasi ${code} ${t.slug}`],
      );
    }
    await q(`INSERT INTO lumbung.flo_clusters (tenant_id, flo_id, cluster_id, is_primary) VALUES ($1, $2, $3, true)`, [
      t.id,
      ids.flo,
      ids.cluster,
    ]);
    await q(
      `INSERT INTO lumbung.flo_contacts (id, tenant_id, flo_id, channel, address_ciphertext, address_hint)
       VALUES ($1, $2, $3, 'SIM', $4, 'sim:flo:00**')`,
      [ids.contact, t.id, ids.flo, randomBytes(32)],
    );
    await q(
      `INSERT INTO lumbung.media_files (id, tenant_id, storage_key, sha256, mime, bytes, uploaded_at, purpose)
       VALUES ($1, $2, $3, $4, 'application/pdf', 1234, '2026-10-20T03:00:00Z', 'AGREEMENT')`,
      [ids.media, t.id, `agreements/${ids.media}.pdf`, hex64()],
    );
    await q(
      `INSERT INTO lumbung.agreements (id, tenant_id, flo_id, document_media_id, version, valid_from_date, valid_through_date,
                                       valid_from, valid_until_exclusive, review_state, uploaded_by, reviewer_id, reviewed_at)
       VALUES ($1, $2, $3, $4, 1, '2026-01-01', '2026-11-15',
               '2025-12-31T17:00:00Z', '2026-11-15T17:00:00Z', 'APPROVED', $5, $6, '2026-01-02T03:00:00Z')`,
      [ids.agreementApproved, t.id, ids.flo, ids.media, coord, reviewer],
    );
    await q(
      `INSERT INTO lumbung.agreements (id, tenant_id, flo_id, version, valid_from_date, valid_through_date,
                                       valid_from, valid_until_exclusive, review_state, uploaded_by, supersedes_id)
       VALUES ($1, $2, $3, 2, '2026-11-16', '2027-11-15',
               '2026-11-15T17:00:00Z', '2027-11-15T17:00:00Z', 'PENDING_VERIFICATION', $4, $5)`,
      [ids.agreementPending, t.id, ids.flo, coord, ids.agreementApproved],
    );
    await q(
      `INSERT INTO lumbung.renewal_tasks (id, tenant_id, agreement_id, offset_days, due_at)
       VALUES ($1, $2, $3, 30, '2026-10-16T17:00:00Z')`,
      [ids.renewal, t.id, ids.agreementApproved],
    );
    await q(
      `INSERT INTO lumbung.need_assessments (id, tenant_id, flo_id, category_id, score, assessed_at, expires_at, status, assessor_id)
       VALUES ($1, $2, $3, $4, 80, '2026-10-20T03:00:00Z', '2026-11-19T03:00:00Z', 'PROPOSED', $5)`,
      [ids.need, t.id, ids.flo, ids.category, coord],
    );
    await q(
      `INSERT INTO lumbung.category_demands (id, tenant_id, flo_id, category_id, unit, basis, quantity, valid_from, status)
       VALUES ($1, $2, $3, $4, 'portion', 'PER_EVENT_QTY', 40, '2026-10-01', 'PROPOSED')`,
      [ids.demand, t.id, ids.flo, ids.category],
    );
    await q(
      `INSERT INTO lumbung.policy_versions (id, tenant_id, kind, code, version, body, status, approved_by, approved_at)
       VALUES ($1, $2, 'ALLOCATION', 'ALLOC-DEMO-2.0', '2.0', '{"weights":{"coverage":0.5,"need":0.5}}', 'APPROVED_DEMO', $3,
               '2026-10-01T03:00:00Z')`,
      [ids.policy, t.id, t.users.ADMIN.id],
    );
    await q(`INSERT INTO lumbung.tenant_active_policies (tenant_id, kind, policy_version_id) VALUES ($1, 'ALLOCATION', $2)`, [
      t.id,
      ids.policy,
    ]);
    for (const key of ACTIVATION_DECISION_KEYS) {
      await q(`INSERT INTO lumbung.activation_decisions (tenant_id, key) VALUES ($1, $2)`, [t.id, key]);
    }
    await q(
      `INSERT INTO lumbung.audit_events (id, tenant_id, actor_id, actor_kind, action, subject_type, subject_id, occurred_at)
       VALUES ($1, $2, $3, 'USER', 'agreement.approve', 'AGREEMENT', $4, '2026-01-02T03:00:00Z')`,
      [ids.audit, t.id, reviewer, ids.agreementApproved],
    );
    await q(
      `INSERT INTO lumbung.domain_events (id, tenant_id, type, object_type, object_id, occurred_at)
       VALUES ($1, $2, 'AgreementApproved', 'AGREEMENT', $3, '2026-01-02T03:00:00Z')`,
      [ids.event, t.id, ids.agreementApproved],
    );
    await q(
      `INSERT INTO lumbung.tasks (id, tenant_id, kind, subject_type, subject_id, dedup_key)
       VALUES ($1, $2, 'AGREEMENT_RENEWAL', 'AGREEMENT', $3, $4)`,
      [ids.task, t.id, ids.agreementApproved, `renewal:${ids.agreementApproved}`],
    );
    await q(
      `INSERT INTO lumbung.idempotency_keys (tenant_id, key, command, request_hash, status, response, http_status)
       VALUES ($1, $2, 'approve_agreement', $3, 'COMPLETED', '{"ok":true}', 200)`,
      [t.id, `idem-${t.slug}`, hex64()],
    );
    await q(
      `INSERT INTO lumbung.flo_access_links (id, tenant_id, flo_id, contact_id, subject_type, subject_id, actions, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, 'DELIVERY', NULL, ARRAY['evidence.submit'], $5, '2026-12-01T00:00:00Z')`,
      [ids.link, t.id, ids.flo, ids.contact, hex64()],
    );
    await q(`INSERT INTO lumbung.simulation_settings (tenant_id) VALUES ($1)`, [t.id]);
  });
  return ids;
}

async function makePopulated(): Promise<TenantData> {
  const t = await makeTenant();
  const superUser = await addSuperUser(t);
  const ids = await populate(t);
  return { ...t, superUser, ids };
}

async function relations(): Promise<Relation[]> {
  return withOwner(async (c) => {
    const r = await c.query<Relation>(
      `SELECT c.relname, c.relkind::text AS relkind,
              has_table_privilege('lumbung_app', c.oid, 'SELECT') AS app_select,
              EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped) AS has_tenant_id
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'lumbung' AND c.relkind IN ('r','p','v','m')
        ORDER BY c.relname`,
    );
    return r.rows;
  });
}

async function secDefFunctions(): Promise<SecDefFn[]> {
  return withOwner(async (c) => {
    const r = await c.query<{
      sig: string;
      proname: string;
      rettype: string;
      retset: boolean;
      in_types: string[];
      names: string[] | null;
      modes: string[] | null;
    }>(
      `SELECT p.oid::regprocedure::text AS sig, p.proname, format_type(p.prorettype, NULL) AS rettype, p.proretset AS retset,
              ARRAY(SELECT format_type(x, NULL) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY u(x, o) ORDER BY o) AS in_types,
              p.proargnames AS names, p.proargmodes::text[] AS modes
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'lumbung' AND p.prosecdef AND p.prokind = 'f'
          AND has_function_privilege('lumbung_app', p.oid, 'EXECUTE')
        ORDER BY p.proname, p.oid`,
    );
    return r.rows.map((f) => {
      const names = f.names ?? [];
      const inNames = f.modes ? names.filter((_, i) => ['i', 'b', 'v'].includes(f.modes![i])) : names;
      return {
        sig: f.sig,
        proname: f.proname,
        rettype: f.rettype,
        retset: f.retset,
        in_types: f.in_types,
        in_names: f.in_types.map((_, i) => inNames[i] ?? ''),
      };
    });
  });
}

/** Owner-side fingerprint of every row tenant A owns (all tenant tables + tenant + its users/memberships). */
async function fingerprint(tenantId: string, rels: Relation[]): Promise<Record<string, string>> {
  return withOwner(async (c) => {
    const out: Record<string, string> = {};
    for (const r of rels.filter((x) => x.has_tenant_id && x.relkind !== 'v' && x.relkind !== 'm')) {
      const q = await c.query<{ h: string | null; n: number }>(
        `SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS h, count(*)::int AS n
           FROM lumbung.${r.relname} t WHERE t.tenant_id = $1`,
        [tenantId],
      );
      out[r.relname] = `${q.rows[0].n}:${q.rows[0].h ?? '-'}`;
    }
    const tr = await c.query<{ h: string }>(`SELECT md5(t::text) AS h FROM lumbung.tenants t WHERE t.id = $1`, [tenantId]);
    out['@tenant'] = tr.rows[0]?.h ?? '-';
    const ur = await c.query<{ h: string | null }>(
      `SELECT md5(string_agg(u::text, '|' ORDER BY u::text)) AS h
         FROM lumbung.users u WHERE u.id IN (SELECT user_id FROM lumbung.memberships WHERE tenant_id = $1)`,
      [tenantId],
    );
    out['@users'] = ur.rows[0]?.h ?? '-';
    return out;
  });
}

/** Argument value for one parameter, aimed at tenant A's id `target`. */
function argFor(type: string, name: string, target: string | null): unknown {
  const n = name.toLowerCase();
  switch (type) {
    case 'uuid':
      return target;
    case 'uuid[]':
      return target ? [target] : null;
    case 'text':
    case 'character varying':
      if (/idem|key/.test(n)) return `iso-${randomUUID()}`;
      if (/hash/.test(n)) return hex64();
      if (/cap/.test(n)) return 'agreement.review';
      if (/reason/.test(n)) return 'uji isolasi tenant';
      return 'ISOLATION_PROBE';
    case 'text[]':
      return ['flo.read'];
    case 'integer':
    case 'smallint':
    case 'bigint':
      return /days/.test(n) ? 30 : 1;
    case 'numeric':
    case 'double precision':
    case 'real':
      return '50';
    case 'boolean':
      return true;
    case 'jsonb':
    case 'json':
      return JSON.stringify({ name: 'ISOLATION-PROBE' });
    case 'date':
      return /through|until|to$|end/.test(n) ? '2027-12-31' : /signed/.test(n) ? '2026-10-20' : '2026-12-01';
    case 'timestamp with time zone':
      return '2026-10-26T01:00:00Z';
    default:
      return null; // composite / unknown: NULL of that type
  }
}

function callSql(f: SecDefFn): string {
  const qualified = f.sig.startsWith('lumbung.') ? f.sig.slice(0, f.sig.indexOf('(')) : `lumbung.${f.proname}`;
  const args = f.in_types.map((ty, i) => `$${i + 1}::${ty}`).join(', ');
  if (f.rettype === 'void' && !f.retset) return `SELECT count(*)::int AS j FROM ${qualified}(${args}) AS x`;
  // to_jsonb works for scalar results (x is the value) and row/TABLE results alike.
  return `SELECT to_jsonb(x)::text AS j FROM ${qualified}(${args}) AS x`;
}

/** Domain code + the underlying Postgres message (DomainError keeps the pg error as cause). */
function describeError(e: unknown): string {
  const d = e as { code?: string; pgCode?: string; message?: string; cause?: { message?: string; code?: string } };
  return [d.code, d.pgCode ?? d.cause?.code, d.cause?.message ?? d.message].filter(Boolean).join(' ');
}

interface Attempt {
  fn: string;
  ctx: string;
  target: string;
  ok: boolean;
  error?: string;
  result?: string;
}

async function attack(
  fns: SecDefFn[],
  targets: Record<string, string>,
  contexts: { label: string; ctx: () => DbCtx }[],
): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  const targetList: [string, string | null][] = [...Object.entries(targets), ['null', null]];
  for (const f of fns) {
    for (const { label, ctx } of contexts) {
      for (const [tname, target] of targetList) {
        const params = f.in_types.map((ty, i) => argFor(ty, f.in_names[i], target));
        try {
          const r = await appTx(ctx(), (c) => c.query<{ j: string | number | null }>(callSql(f), params));
          attempts.push({ fn: f.proname, ctx: label, target: tname, ok: true, result: JSON.stringify(r.rows) });
        } catch (e) {
          attempts.push({ fn: f.proname, ctx: label, target: tname, ok: false, error: describeError(e) });
        }
      }
    }
  }
  return attempts;
}

let rels: Relation[];
let fns: SecDefFn[];

beforeAll(async () => {
  A = await makePopulated();
  B = await makePopulated();
  C_LIVE = await makeTenant(undefined, { mode: 'LIVE' });
  rels = await relations();
  fns = await secDefFunctions();
});

afterAll(() => {
  // pools are closed by tests/setup/db-env.ts
});

describe('AC40 reads: tenant-B context sees nothing of tenant A', () => {
  it('covers every tenant relation, and tenant A has rows in the Stage-1 core tables', async () => {
    const tenantRels = rels.filter((r) => r.has_tenant_id);
    expect(tenantRels.length).toBeGreaterThan(50);
    const fp = await fingerprint(A.id, rels);
    const populated = Object.entries(fp).filter(([k, v]) => !k.startsWith('@') && !v.startsWith('0:')).map(([k]) => k);
    for (const core of [
      'activation_decisions', 'agreements', 'audit_events', 'categories', 'category_demands', 'clusters', 'domain_events',
      'flo_access_links', 'flo_clusters', 'flo_contacts', 'flos', 'idempotency_keys', 'media_files', 'memberships',
      'need_assessments', 'policy_versions', 'renewal_tasks', 'simulation_settings', 'tasks', 'tenant_active_policies',
      'tenant_clocks',
    ]) {
      expect(populated, `tenant A fixture should populate ${core}`).toContain(core);
    }
    console.info(`[isolation] ${tenantRels.length} tenant relations; tenant A populated in ${populated.length}`);
  });

  it('as lumbung_app with tenant B context: count(*) WHERE tenant_id = A is 0 for every tenant relation', async () => {
    const failures: string[] = [];
    for (const r of rels.filter((x) => x.has_tenant_id)) {
      for (const ctx of [userCtx(B.id, B.superUser), { ...userCtx(B.id, null), actorKind: 'WORKER' as const }]) {
        try {
          const n = await appTx(ctx, async (c) => {
            const q = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM lumbung.${r.relname} WHERE tenant_id = $1`, [A.id]);
            return q.rows[0].n;
          });
          if (n !== 0) failures.push(`${r.relname} (${ctx.actorKind}): ${n} rows of tenant A visible`);
          if (!r.app_select) failures.push(`${r.relname}: readable although the app has no SELECT grant`);
        } catch (e) {
          const code = (e as { code?: string }).code;
          // Not readable at all is isolation too (idempotency_keys, flo_access_links).
          if (r.app_select || code !== 'FORBIDDEN') failures.push(`${r.relname}: unexpected error ${code ?? e}`);
        }
      }
    }
    // tenants / users have no tenant_id column: check them by id.
    const special = await appTx(userCtx(B.id, B.superUser), async (c) => {
      const t = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM lumbung.tenants WHERE id = $1`, [A.id]);
      const u = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM lumbung.users WHERE id = ANY($1::uuid[])`, [
        [...Object.values(A.users).map((x) => x.id), A.superUser],
      ]);
      return { tenants: t.rows[0].n, users: u.rows[0].n };
    });
    expect(special).toEqual({ tenants: 0, users: 0 });
    expect(failures).toEqual([]);
  });

  it('positive control: in tenant A context the app sees exactly the owner-side rows of A', async () => {
    const mismatches: string[] = [];
    for (const r of rels.filter((x) => x.has_tenant_id && x.app_select)) {
      const owner = await withOwner((c) =>
        c.query<{ n: number }>(`SELECT count(*)::int AS n FROM lumbung.${r.relname} WHERE tenant_id = $1`, [A.id]),
      );
      const app = await appTx(userCtx(A.id, A.superUser), (c) =>
        c.query<{ n: number }>(`SELECT count(*)::int AS n FROM lumbung.${r.relname} WHERE tenant_id = $1`, [A.id]),
      );
      if (owner.rows[0].n !== app.rows[0].n) mismatches.push(`${r.relname}: owner ${owner.rows[0].n} vs app ${app.rows[0].n}`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('AC40 functions: SECURITY DEFINER functions granted to lumbung_app', () => {
  it('discovers the granted SECURITY DEFINER set from the catalog (includes require_cap and has_cap)', () => {
    const names = fns.map((f) => f.proname);
    expect(names).toContain('require_cap');
    expect(names).toContain('has_cap');
    console.info(`[isolation] SECURITY DEFINER functions granted to lumbung_app: ${names.join(', ')}`);
  });

  it('invoked with tenant-B (and forged) contexts against tenant A ids: fail or affect nothing, never leak', async () => {
    const targets = { ...A.ids, tenantA: A.id, userA: A.users.ADMIN_COORDINATOR.id };
    const before = await fingerprint(A.id, rels);
    const contexts = [
      { label: 'B super user', ctx: () => userCtx(B.id, B.superUser) },
      { label: 'B worker', ctx: () => ({ ...userCtx(B.id, null), actorKind: 'WORKER' as const }) },
      { label: 'B agent', ctx: () => ({ ...userCtx(B.id, null), actorKind: 'AGENT' as const }) },
      { label: 'tenant B + A user (forged)', ctx: () => userCtx(B.id, A.superUser) },
      { label: 'tenant A + B user (forged)', ctx: () => userCtx(A.id, B.superUser) },
    ];
    const targetFns = fns.filter((f) => !(f.proname in FUNCTION_ALLOWLIST));
    const attempts = await attack(targetFns, targets, contexts);
    expect(attempts.length).toBeGreaterThan(0);

    const after = await fingerprint(A.id, rels);
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    expect(changed, 'tenant A data changed by a cross-tenant call').toEqual([]);

    const aIdentifiers = [A.id, A.slug, A.superUser, ...Object.values(A.ids), ...Object.values(A.users).map((u) => u.id)];
    const leaks = attempts.filter((x) => x.ok && aIdentifiers.some((id) => x.result!.includes(id)));
    expect(leaks, 'a cross-tenant call returned tenant A identifiers').toEqual([]);

    // Forged user/tenant pairs (no membership) must never pass a guard; has_cap may only say false.
    const forgedOk = attempts.filter(
      (x) => x.ok && x.ctx.endsWith('(forged)') && !(x.fn === 'has_cap' && x.result === '[{"j":"false"}]'),
    );
    expect(forgedOk).toEqual([]);

    const summary = new Map<string, { ok: number; failed: number }>();
    for (const x of attempts) {
      const s = summary.get(x.fn) ?? { ok: 0, failed: 0 };
      if (x.ok) s.ok++;
      else s.failed++;
      summary.set(x.fn, s);
    }
    console.info(`[isolation] ${attempts.length} cross-tenant calls: ${[...summary].map(([k, v]) => `${k} ok=${v.ok}/fail=${v.failed}`).join('; ')}`);
  });

  it('positive control: the same argument vectors run as tenant A’s own user do change A (so the check above is meaningful)', async () => {
    const targetFns = fns.filter((f) => !(f.proname in FUNCTION_ALLOWLIST));
    if (!targetFns.some((f) => f.rettype !== 'void' && f.rettype !== 'boolean')) {
      console.info('[isolation] no SECURITY DEFINER command functions granted yet; positive control skipped');
      return;
    }
    const before = await fingerprint(A.id, rels);
    const attempts = await attack(targetFns, { ...A.ids }, [{ label: 'A super user', ctx: () => userCtx(A.id, A.superUser) }]);
    const after = await fingerprint(A.id, rels);
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    if (process.env.ISO_DEBUG) console.log(attempts.map((x) => `${x.fn} ${x.target} ${x.ok} ${x.error ?? x.result}`).join('\n'));
    expect(attempts.some((x) => x.ok && x.fn !== 'has_cap' && x.fn !== 'require_cap')).toBe(true);
    expect(changed.length).toBeGreaterThan(0);
  });

  it('demo_login_directory (allow-listed, pre-login) never exposes LIVE tenants', async () => {
    const dir = fns.find((f) => f.proname === 'demo_login_directory');
    if (!dir) {
      console.info('[isolation] demo_login_directory() not present in migrations yet');
      return;
    }
    const rows = await appTx(userCtx(null, null), (c) =>
      c.query<{ tenant_id: string; tenant_mode: string }>(`SELECT tenant_id, tenant_mode FROM lumbung.demo_login_directory()`),
    );
    expect(rows.rows.some((r) => r.tenant_id === C_LIVE.id)).toBe(false);
    expect(rows.rows.every((r) => r.tenant_mode === 'DEMO' || r.tenant_mode === 'TEST')).toBe(true);
  });
});

describe('AC40 no context: fail closed', () => {
  it('every app-readable relation returns zero rows without a tenant context', async () => {
    const nonEmpty: string[] = [];
    for (const ctx of [userCtx(null, null), userCtx(null, A.superUser), { ...userCtx(null, null), actorKind: 'SYSTEM' as const }]) {
      for (const r of rels.filter((x) => x.app_select)) {
        if (r.relname in GLOBAL_RELATIONS) continue;
        const n = await appTx(ctx, async (c) => {
          const q = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM lumbung.${r.relname}`);
          return q.rows[0].n;
        });
        if (n !== 0) nonEmpty.push(`${r.relname} (${ctx.actorKind}, user=${ctx.userId ?? 'none'}): ${n}`);
      }
    }
    expect(nonEmpty).toEqual([]);
  });

  it('SECURITY DEFINER functions fail (or return a non-leaking false) without a tenant context', async () => {
    const before = await fingerprint(A.id, rels);
    const targetFns = fns.filter((f) => !(f.proname in FUNCTION_ALLOWLIST));
    const attempts = await attack(targetFns, { flo: A.ids.flo, agreement: A.ids.agreementPending }, [
      { label: 'no context', ctx: () => userCtx(null, null) },
      { label: 'no tenant + A user', ctx: () => userCtx(null, A.superUser) },
    ]);
    const unexpected = attempts.filter((x) => x.ok && !(x.fn === 'has_cap' && x.result === '[{"j":"false"}]'));
    expect(unexpected).toEqual([]);
    expect(await fingerprint(A.id, rels)).toEqual(before);
  });
});
