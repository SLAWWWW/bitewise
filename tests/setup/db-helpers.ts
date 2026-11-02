/**
 * DB test helpers (db project only; requires tests/setup/global-db.ts).
 *
 *   const owner = ownerPool();
 *   const t = await makeTenant(owner, { mode: 'TEST' });
 *   await withAppTx(ctxFor(t, 'COORDINATOR'), (c) => c.query('select ...'));
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import type pg from 'pg';
import { createOwnerPool } from '@/src/db/owner';
import { withTx } from '@/src/db/tx';
import type { ActorKind, DbCtx, TxClient } from '@/src/db/types';
import { ROLE_CAPABILITIES, capabilitiesForRoles, type Capability, type Role } from '@/src/shared/capabilities';
import type { ClockMode, TenantMode } from '@/src/shared/enums';
import { entityId, tenantNamespace } from '@/src/lib/uuidv5';

export const appUrl = (): string => inject('TEST_DATABASE_URL');
export const ownerUrl = (): string => inject('TEST_DATABASE_OWNER_URL');
export const adminUrl = (): string => inject('TEST_DATABASE_ADMIN_URL');

let owner: pg.Pool | undefined;

/** Shared owner-role pool for this test file (bypasses RLS; setup/fixtures only). */
export function ownerPool(): pg.Pool {
  owner ??= createOwnerPool(ownerUrl(), 4);
  return owner;
}

export async function closeOwnerPool(): Promise<void> {
  const p = owner;
  owner = undefined;
  if (p) await p.end();
}

/** Run `fn` as lumbung_app inside withTx with the given context (RLS applies). */
export function withAppTx<T>(ctx: DbCtx, fn: (c: TxClient) => Promise<T>): Promise<T> {
  return withTx(ctx, fn, { retries: 0 });
}

/** Run `fn` as lumbung_owner in a committed transaction. */
export async function withOwner<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await ownerPool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export interface TestUser {
  id: string;
  displayName: string;
  roleLabel: string;
  capabilities: Capability[];
}

export interface TestTenant {
  id: string;
  slug: string;
  name: string;
  mode: TenantMode;
  ns: string;
  clock: { mode: ClockMode; simAnchor: string };
  /** One user per role (ROLE_CAPABILITIES) plus ADMIN_COORDINATOR (the demo admin bundle). */
  users: Record<Role | 'ADMIN_COORDINATOR', TestUser>;
}

export interface MakeTenantOptions {
  slug?: string;
  mode?: TenantMode;
  name?: string;
  timezone?: string;
  /** Default FROZEN at the seed instant 2026-10-26T01:00:00Z (08:00 WIB). */
  clockMode?: ClockMode;
  simAnchor?: string;
}

export const SEED_INSTANT = '2026-10-26T01:00:00.000Z';

/**
 * Create a tenant + clock + users + ACTIVE memberships via owner SQL. IDs are uuidv5
 * under the tenant namespace, so they are stable per slug. Default slug is random.
 */
export async function makeTenant(pool: pg.Pool = ownerPool(), opts: MakeTenantOptions = {}): Promise<TestTenant> {
  const slug = opts.slug ?? `t-${randomBytes(5).toString('hex')}`;
  const mode = opts.mode ?? 'TEST';
  const name = opts.name ?? `Tenant Uji ${slug}`;
  const ns = tenantNamespace(slug);
  const tenantId = entityId(ns, 'tenant', slug);
  const clockMode = opts.clockMode ?? 'FROZEN';
  const simAnchor = opts.simAnchor ?? SEED_INSTANT;

  const bundles: [Role | 'ADMIN_COORDINATOR', string, Capability[]][] = [
    ...(Object.keys(ROLE_CAPABILITIES) as Role[]).map(
      (r) => [r, r, capabilitiesForRoles([r])] as [Role, string, Capability[]],
    ),
    ['ADMIN_COORDINATOR', 'ADMIN+COORDINATOR', capabilitiesForRoles(['ADMIN', 'COORDINATOR'])],
  ];

  const users = {} as TestTenant['users'];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO lumbung.tenants (id, slug, name, timezone, mode, is_demo) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, slug, name, opts.timezone ?? 'Asia/Jakarta', mode, mode !== 'LIVE'],
    );
    await c.query(
      `INSERT INTO lumbung.tenant_clocks (tenant_id, mode, sim_anchor, real_anchor)
       VALUES ($1, $2, $3, CASE WHEN $2 = 'TICKING' THEN now() END)`,
      [tenantId, clockMode, clockMode === 'REAL' ? null : simAnchor],
    );
    for (const [key, roleLabel, caps] of bundles) {
      const id = entityId(ns, 'user', key);
      const displayName = `${key} ${slug}`;
      await c.query(`INSERT INTO lumbung.users (id, display_name, email, kind) VALUES ($1, $2, $3, 'HUMAN')`, [
        id,
        displayName,
        `${key.toLowerCase()}.${slug}@example.invalid`,
      ]);
      await c.query(
        `INSERT INTO lumbung.memberships (id, tenant_id, user_id, role_label, capabilities, status)
         VALUES ($1, $2, $3, $4, $5::text[], 'ACTIVE')`,
        [entityId(ns, 'membership', key), tenantId, id, roleLabel, caps],
      );
      users[key] = { id, displayName, roleLabel, capabilities: caps };
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
  return { id: tenantId, slug, name, mode, ns, clock: { mode: clockMode, simAnchor }, users };
}

/** DbCtx for a tenant user (default COORDINATOR) or a non-human actor kind. */
export function ctxFor(
  t: Pick<TestTenant, 'id' | 'users'>,
  who: Role | 'ADMIN_COORDINATOR' | { kind: Exclude<ActorKind, 'USER'>; linkId?: string } = 'COORDINATOR',
): DbCtx {
  if (typeof who === 'object') {
    return { tenantId: t.id, userId: null, actorKind: who.kind, linkId: who.linkId ?? null, correlationId: randomUUID() };
  }
  return { tenantId: t.id, userId: t.users[who].id, actorKind: 'USER', correlationId: randomUUID() };
}
