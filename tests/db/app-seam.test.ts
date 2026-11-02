/**
 * W1-INFRA: app/DB seam against the real (embedded) Postgres — withTx context GUCs,
 * type parsers, error mapping, RLS fail-closed, actor loading, session cookie flow and
 * handler() auth/capability checks.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '@/src/db/errors';
import { getActor, getTenantClock, listDemoLogins, loadActor } from '@/src/security/actor';
import { signSession } from '@/src/security/session';
import { getEnv } from '@/src/config/env';
import { handler } from '@/src/http/handler';
import { makeTenant, ownerPool, withAppTx, withOwner, ctxFor, SEED_INSTANT, type TestTenant } from '../setup/db-helpers';
import * as sessionRoute from '@/app/api/session/route';

let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  a = await makeTenant(ownerPool(), { mode: 'TEST' });
  b = await makeTenant(ownerPool(), { mode: 'TEST' });
});

afterAll(async () => {
  await withOwner(async (c) => {
    await c.query(`SELECT set_config('lumbung.reset_tenant', $1, true)`, [a.id]);
    await c.query('DELETE FROM lumbung.tenants WHERE id = $1', [a.id]);
  }).catch(() => undefined);
});

function cookieFor(t: TestTenant, role: keyof TestTenant['users'] = 'COORDINATOR') {
  const token = signSession({ uid: t.users[role].id, tid: t.id }, { secret: getEnv().SESSION_SECRET, now: new Date() });
  return `lb_session=${token}`;
}

describe('withTx', () => {
  it('sets the five context GUCs in the transaction', async () => {
    const ctx = { ...ctxFor(a), correlationId: 'corr-seam-0001' };
    const row = await withAppTx(ctx, async (c) =>
      (
        await c.query(
          `SELECT lumbung.current_tenant() AS t, lumbung.current_user_id() AS u, lumbung.current_actor_kind() AS k,
                  current_setting('app.correlation_id', true) AS corr, current_user AS role`,
        )
      ).rows[0],
    );
    expect(row).toEqual({ t: a.id, u: a.users.COORDINATOR.id, k: 'USER', corr: 'corr-seam-0001', role: 'lumbung_app' });
  });

  it('isolates tenants through RLS and fails closed without a tenant', async () => {
    const seen = await withAppTx(ctxFor(a), async (c) => (await c.query('SELECT id FROM lumbung.tenants')).rows);
    expect(seen.map((r) => r.id)).toEqual([a.id]);
    const none = await withAppTx({ tenantId: null, actorKind: 'SYSTEM', correlationId: randomUUID() }, async (c) =>
      (await c.query('SELECT count(*)::int AS n FROM lumbung.memberships')).rows[0].n,
    );
    expect(none).toBe(0);
  });

  it('installs the type parsers (date/numeric/int8 → string, timestamptz → Date)', async () => {
    const r = await withAppTx(ctxFor(a), async (c) =>
      (
        await c.query(
          `SELECT '2026-10-31'::date AS d, 40.500::numeric(14,3) AS q, 5::int8 AS n,
                  ARRAY['2026-10-31'::date] AS ds, ARRAY[1.5::numeric] AS qs, lumbung.tenant_now() AS now`,
        )
      ).rows[0],
    );
    expect(r.d).toBe('2026-10-31');
    expect(r.q).toBe('40.500');
    expect(r.n).toBe('5');
    expect(r.ds).toEqual(['2026-10-31']);
    expect(r.qs).toEqual(['1.5']);
    expect(r.now).toBeInstanceOf(Date);
    expect((r.now as Date).toISOString()).toBe(SEED_INSTANT);
  });

  it('commits on success and rolls back on error', async () => {
    const key = `seam-${randomUUID()}`;
    await expect(
      withAppTx(ctxFor(a), async (c) => {
        await c.query(`INSERT INTO lumbung.tasks (tenant_id, kind, dedup_key) VALUES ($1, 'SEAM_TEST', $2)`, [a.id, key]);
        throw new DomainError({ code: 'CONFLICT' });
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const count = async () =>
      withAppTx(ctxFor(a), async (c) =>
        (await c.query('SELECT count(*)::int AS n FROM lumbung.tasks WHERE dedup_key = $1', [key])).rows[0].n,
      );
    expect(await count()).toBe(0);
    await withAppTx(ctxFor(a), (c) =>
      c.query(`INSERT INTO lumbung.tasks (tenant_id, kind, dedup_key) VALUES ($1, 'SEAM_TEST', $2)`, [a.id, key]),
    );
    expect(await count()).toBe(1);
  });

  it('retries serialization failures and gives up with a retryable DomainError', async () => {
    const { withTx } = await import('@/src/db/tx');
    let attempts = 0;
    const out = await withTx(ctxFor(a), async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('could not serialize'), { code: '40001' });
      return 'ok';
    });
    expect([out, attempts]).toEqual(['ok', 3]);
    attempts = 0;
    await expect(
      withTx(
        ctxFor(a),
        async () => {
          attempts++;
          throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
        },
        { retries: 2 },
      ),
    ).rejects.toMatchObject({ code: 'SERIALIZATION_FAILURE', retryable: true });
    expect(attempts).toBe(3);
  });

  it('maps real Postgres errors: 42501 → FORBIDDEN, LB:FORBIDDEN from require_cap → 403', async () => {
    const e1 = await withAppTx(ctxFor(a), (c) => c.query(`UPDATE lumbung.tenant_clocks SET mode = 'REAL'`)).catch((e) => e);
    expect(e1).toBeInstanceOf(DomainError);
    expect([e1.code, e1.http, e1.pgCode]).toEqual(['FORBIDDEN', 403, '42501']);
    const e2 = await withAppTx(ctxFor(a, 'AUDITOR'), (c) => c.query(`SELECT lumbung.require_cap('dispatch.approve')`)).catch(
      (e) => e,
    );
    expect([e2.code, e2.http, e2.pgCode]).toEqual(['FORBIDDEN', 403, 'P0001']);
    const ok = await withAppTx(ctxFor(a), (c) => c.query(`SELECT lumbung.require_cap('dispatch.approve')`));
    expect(ok.rowCount).toBe(1);
  });
});

describe('actor loading', () => {
  it('loads membership capabilities from the DB', async () => {
    const actor = await loadActor({ uid: a.users.AUDITOR.id, tid: a.id });
    expect(actor).toMatchObject({ userId: a.users.AUDITOR.id, tenantId: a.id, tenantMode: 'TEST', roleLabel: 'AUDITOR' });
    expect(actor!.capabilities).toEqual(['flo.read', 'audit.read']);
  });

  it('returns null for another tenant, a suspended membership or a LIVE tenant in TEST mode', async () => {
    expect(await loadActor({ uid: a.users.AUDITOR.id, tid: b.id })).toBeNull();
    await withOwner((c) =>
      c.query(`UPDATE lumbung.memberships SET status = 'SUSPENDED' WHERE tenant_id = $1 AND user_id = $2`, [
        b.id,
        b.users.WAREHOUSE.id,
      ]),
    );
    expect(await loadActor({ uid: b.users.WAREHOUSE.id, tid: b.id })).toBeNull();
    const live = await makeTenant(ownerPool(), { mode: 'LIVE' });
    expect(await loadActor({ uid: live.users.ADMIN.id, tid: live.id })).toBeNull();
  });

  it('getActor verifies the signed cookie on a Request', async () => {
    const ok = await getActor(new Request('http://x/api', { headers: { cookie: cookieFor(a) } }));
    expect(ok?.userId).toBe(a.users.COORDINATOR.id);
    const forged = cookieFor(a).slice(0, -3) + 'AAA';
    expect(await getActor(new Request('http://x/api', { headers: { cookie: forged } }))).toBeNull();
    expect(await getActor(new Request('http://x/api'))).toBeNull();
  });

  it('reads the tenant clock (FROZEN at the seed instant)', async () => {
    expect(await getTenantClock({ tenantId: a.id, userId: a.users.COORDINATOR.id })).toEqual({
      now: SEED_INSTANT,
      mode: 'FROZEN',
    });
  });
});

describe('handler() with real sessions', () => {
  const h = handler({ capability: 'dispatch.approve' }, async ({ actor, tx }) => {
    const n = await tx(async (c) => (await c.query('SELECT count(*)::int AS n FROM lumbung.tenants')).rows[0].n);
    return { user: actor.userId, visibleTenants: n };
  });

  it('401 without a session, 403 without the capability, 200 with it', async () => {
    expect((await h(new Request('http://x/api/t'))).status).toBe(401);
    const denied = await h(new Request('http://x/api/t', { headers: { cookie: cookieFor(a, 'AUDITOR') } }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('CAPABILITY_REQUIRED');
    const ok = await h(new Request('http://x/api/t', { headers: { cookie: cookieFor(a) } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toEqual({ user: a.users.COORDINATOR.id, visibleTenants: 1 });
  });
});

describe('/api/session', () => {
  it('GET returns the current actor or null; DELETE clears the cookie', async () => {
    const me = await sessionRoute.GET(new Request('http://x/api/session', { headers: { cookie: cookieFor(a) } }));
    expect((await me.json()).data).toMatchObject({ user_id: a.users.COORDINATOR.id, tenant_id: a.id });
    const anon = await sessionRoute.GET(new Request('http://x/api/session'));
    expect((await anon.json()).data).toBeNull();
    const out = await sessionRoute.DELETE(new Request('http://x/api/session', { method: 'DELETE' }));
    expect(out.headers.get('set-cookie')).toMatch(/^lb_session=; Path=\/; Max-Age=0/);
  });

  it('POST signs in a demo/test user via lumbung.demo_login_directory()', async () => {
    const hasFn = await withOwner(async (c) =>
      (await c.query(`SELECT to_regprocedure('lumbung.demo_login_directory()') IS NOT NULL AS ok`)).rows[0].ok,
    );
    if (!hasFn) {
      // Pending W1-DB: without the directory function sign-in fails closed (no session issued).
      const r = await sessionRoute.POST(
        new Request('http://x/api/session', { method: 'POST', body: JSON.stringify({ user_id: a.users.ADMIN.id }) }),
      );
      expect(r.status).toBeGreaterThanOrEqual(500);
      expect(r.headers.get('set-cookie')).toBeNull();
      return;
    }
    expect((await listDemoLogins({ userId: a.users.ADMIN.id })).map((e) => e.tenant_id)).toEqual([a.id]);
    const r = await sessionRoute.POST(
      new Request('http://x/api/session', {
        method: 'POST',
        body: JSON.stringify({ user_id: a.users.ADMIN.id, tenant_id: a.id }),
      }),
    );
    expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^lb_session=[^;]+; Path=\/; Max-Age=43200; SameSite=Lax; HttpOnly/);
    const me = await getActor(new Request('http://x', { headers: { cookie: cookie.split(';')[0] } }));
    expect(me?.userId).toBe(a.users.ADMIN.id);
    const unknown = await sessionRoute.POST(
      new Request('http://x/api/session', { method: 'POST', body: JSON.stringify({ user_id: randomUUID() }) }),
    );
    expect(unknown.status).toBe(404);
  });

  it('POST rejects cross-origin requests and invalid bodies', async () => {
    const cross = await sessionRoute.POST(
      new Request('http://x/api/session', {
        method: 'POST',
        headers: { origin: 'http://evil.example' },
        body: JSON.stringify({ user_id: a.users.ADMIN.id }),
      }),
    );
    expect(cross.status).toBe(403);
    const bad = await sessionRoute.POST(
      new Request('http://x/api/session', { method: 'POST', body: JSON.stringify({ user_id: 'nope' }) }),
    );
    expect(bad.status).toBe(400);
  });
});
