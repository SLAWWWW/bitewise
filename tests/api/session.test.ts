/**
 * /api/session (architecture G.4): demo sign-in sets a signed cookie, tampered or
 * foreign cookies are rejected, and LIVE mode refuses demo sessions.
 *
 * Runs in a PRIVATE migrated database (not the shared per-run one): while W1-DB has not
 * shipped `lumbung.demo_login_directory()` this file installs the exact SQL W1-INFRA
 * proposed, and that SECURITY DEFINER function (no require_ctx by design) must not leak
 * into the shared database where tests/db/rls-catalog.test.ts audits every function.
 * Once the function is in a migration the shim is skipped automatically.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getEnv, resetEnvCache } from '@/src/config/env';
import { createOwnerPool } from '@/src/db/owner';
import { configureDb } from '@/src/db/pool';
import { createMigratedDatabase, rolePasswordsFromEnv, type ScratchDatabase } from '@/src/db/migrate-lib';
import { getActor, listDemoLogins } from '@/src/security/actor';
import { SESSION_COOKIE, signSession, verifySession } from '@/src/security/session';
import * as sessionRoute from '@/app/api/session/route';
import * as auditRoute from '@/app/api/audit/route';
import { adminUrl, appUrl, makeTenant, type TestTenant } from '../setup/db-helpers';

const DIRECTORY_SHIM = `
CREATE FUNCTION lumbung.demo_login_directory()
  RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_name text, tenant_mode text, user_id uuid, display_name text, role_label text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lumbung, pg_temp AS $$
  SELECT t.id, t.slug, t.name, t.mode, u.id, u.display_name, m.role_label
    FROM lumbung.tenants t
    JOIN lumbung.memberships m ON m.tenant_id = t.id AND m.status = 'ACTIVE'
    JOIN lumbung.users u ON u.id = m.user_id AND u.kind = 'HUMAN'
   WHERE t.mode IN ('DEMO','TEST') AND t.is_demo
$$;
REVOKE ALL ON FUNCTION lumbung.demo_login_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lumbung.demo_login_directory() TO lumbung_app;`;

let db: ScratchDatabase;
let owner: pg.Pool;
let shimInstalled = false;
let a: TestTenant;
let b: TestTenant;
let liveTenant: TestTenant;

const savedEnv = { ...process.env };

function restoreEnv() {
  for (const k of ['APP_MODE', 'SESSION_SECRET', 'CONTACT_ENC_KEY', 'DATABASE_OWNER_URL', 'DATABASE_ADMIN_URL']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetEnvCache();
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return sessionRoute.POST(
    new Request('http://x/api/session', { method: 'POST', body: JSON.stringify(body), headers }),
  );
}

async function me(cookieValue: string | null) {
  const headers: Record<string, string> = {};
  if (cookieValue !== null) headers.cookie = `${SESSION_COOKIE}=${cookieValue}`;
  const r = await sessionRoute.GET(new Request('http://x/api/session', { headers }));
  return ((await r.json()) as { data: { user_id: string; tenant_id: string; capabilities: string[] } | null }).data;
}

async function auditStatus(cookieValue: string) {
  const r = await auditRoute.GET(new Request('http://x/api/audit', { headers: { cookie: `${SESSION_COOKIE}=${cookieValue}` } }));
  return r.status;
}

function tokenFromSetCookie(setCookie: string | null): string {
  expect(setCookie).toBeTruthy();
  const m = new RegExp(`^${SESSION_COOKIE}=([^;]+);`).exec(setCookie!);
  expect(m).not.toBeNull();
  return decodeURIComponent(m![1]);
}

beforeAll(async () => {
  // process.env.DATABASE_URL / DATABASE_OWNER_URL carry the passwords global-db bootstrapped with.
  db = await createMigratedDatabase(adminUrl(), `lumbung_test_sess_${process.pid}_${randomBytes(4).toString('hex')}`, rolePasswordsFromEnv());
  owner = createOwnerPool(db.ownerUrl, 2);
  const exists = await owner.query<{ ok: boolean }>(
    `SELECT to_regprocedure('lumbung.demo_login_directory()') IS NOT NULL AS ok`,
  );
  if (!exists.rows[0].ok) {
    await owner.query(DIRECTORY_SHIM);
    shimInstalled = true;
  }
  await configureDb({ connectionString: db.appUrl, max: 4 });
  a = await makeTenant(owner, { mode: 'TEST' });
  b = await makeTenant(owner, { mode: 'DEMO' });
  liveTenant = await makeTenant(owner, { mode: 'LIVE' });
});

afterEach(restoreEnv);

afterAll(async () => {
  restoreEnv();
  await configureDb({ connectionString: appUrl(), max: 5 });
  await owner?.end();
  await db?.drop();
});

describe('POST /api/session (DEMO/TEST)', () => {
  it('signs in a seeded demo user and sets a signed HttpOnly cookie whose capabilities come from the DB', async () => {
    if (shimInstalled) console.info('[session.test] demo_login_directory() not in migrations yet: using the proposed SQL in a private DB');
    const res = await post({ user_id: a.users.ADMIN_COORDINATOR.id });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toMatch(/^lb_session=[^;]+; Path=\/; Max-Age=43200; SameSite=Lax; HttpOnly$/);
    const token = tokenFromSetCookie(setCookie);

    const payload = verifySession(token, { secret: getEnv().SESSION_SECRET, now: new Date() });
    expect(payload).toMatchObject({ uid: a.users.ADMIN_COORDINATOR.id, tid: a.id });
    expect(payload!.exp - payload!.iat).toBe(12 * 3600);
    // The cookie identifies only (user, tenant): no capabilities inside.
    expect(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).not.toContain('capab');

    const body = (await res.json()) as { data: { capabilities: string[] } };
    expect([...body.data.capabilities].sort()).toEqual([...a.users.ADMIN_COORDINATOR.capabilities].sort());

    const who = await me(token);
    expect(who).toMatchObject({ user_id: a.users.ADMIN_COORDINATOR.id, tenant_id: a.id });
    expect(await auditStatus(token)).toBe(200);
  });

  it('refuses users who are not in a DEMO/TEST demo tenant, unknown users and suspended memberships', async () => {
    const live = await post({ user_id: liveTenant.users.ADMIN.id });
    expect(live.status).toBe(404);
    expect(live.headers.get('set-cookie')).toBeNull();

    const unknown = await post({ user_id: randomUUID() });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('set-cookie')).toBeNull();

    await owner.query(`UPDATE lumbung.memberships SET status = 'SUSPENDED' WHERE tenant_id = $1 AND user_id = $2`, [
      b.id,
      b.users.WAREHOUSE.id,
    ]);
    const suspended = await post({ user_id: b.users.WAREHOUSE.id });
    expect(suspended.status).toBe(404);
    expect(suspended.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a cross-origin POST (login CSRF) without setting a cookie', async () => {
    const res = await post({ user_id: a.users.AUDITOR.id }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('tampered and foreign cookies', () => {
  it('rejects a cookie with a modified signature, payload, secret or expiry', async () => {
    const secret = getEnv().SESSION_SECRET;
    const now = new Date();
    const good = signSession({ uid: a.users.AUDITOR.id, tid: a.id }, { secret, now });
    expect(await me(good)).not.toBeNull();

    const [body, sig] = good.split('.');
    const flipped = `${body}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    // Swap in tenant B's admin while keeping A-auditor's signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString('utf8')), uid: b.users.ADMIN.id, tid: b.id }),
    ).toString('base64url');
    const swapped = `${forgedPayload}.${sig}`;
    const wrongSecret = signSession({ uid: a.users.ADMIN.id, tid: a.id }, { secret: 'x'.repeat(48), now });
    const expired = signSession(
      { uid: a.users.ADMIN.id, tid: a.id },
      { secret, now: new Date(now.getTime() - 13 * 3600_000) },
    );
    const unsigned = body;

    for (const bad of [flipped, swapped, wrongSecret, expired, unsigned, 'garbage', '']) {
      expect(await me(bad)).toBeNull();
      if (bad) expect(await auditStatus(bad)).toBe(401);
      expect(await getActor(new Request('http://x', { headers: { cookie: `${SESSION_COOKIE}=${bad}` } }))).toBeNull();
    }
  });

  it('rejects a validly signed cookie that pairs a user with a tenant they do not belong to', async () => {
    const secret = getEnv().SESSION_SECRET;
    const crossed = signSession({ uid: a.users.ADMIN.id, tid: b.id }, { secret, now: new Date() });
    expect(await me(crossed)).toBeNull();
    expect(await auditStatus(crossed)).toBe(401);
  });
});

describe('LIVE mode', () => {
  function goLive() {
    process.env.APP_MODE = 'LIVE';
    process.env.SESSION_SECRET = `live-${randomBytes(24).toString('hex')}`;
    process.env.CONTACT_ENC_KEY = randomBytes(32).toString('base64');
    delete process.env.DATABASE_OWNER_URL; // the LIVE web process refuses owner/admin URLs
    delete process.env.DATABASE_ADMIN_URL;
    resetEnvCache();
    expect(getEnv().APP_MODE).toBe('LIVE');
  }

  it('refuses demo sign-in (403 DEMO_ONLY, no cookie) and lists no demo users', async () => {
    goLive();
    const res = await post({ user_id: a.users.ADMIN_COORDINATOR.id });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DEMO_ONLY');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await listDemoLogins()).toEqual([]);
  });

  it('does not accept a session for a DEMO/TEST tenant, even when signed with the LIVE secret', async () => {
    goLive();
    const token = signSession({ uid: a.users.ADMIN.id, tid: a.id }, { secret: getEnv().SESSION_SECRET, now: new Date() });
    expect(await me(token)).toBeNull();
    expect(await auditStatus(token)).toBe(401);
  });
});
