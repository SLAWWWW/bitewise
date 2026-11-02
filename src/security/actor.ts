/**
 * Actor resolution (architecture G.4).
 *
 *  - Route handlers: `getActor(request)` reads `lb_session` from the Request headers
 *    (never `next/headers`, so handlers stay testable from vitest).
 *  - Server components: `getServerActor()` uses `await cookies()`.
 *
 * Both verify the HMAC, then load the ACTIVE membership + capabilities from the DB in
 * a tenant-scoped transaction. Capabilities are never taken from the cookie. Returns
 * null when anything is invalid.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import { getEnv, isDemoLike } from '@/src/config/env';
import { withTx } from '@/src/db/tx';
import { isCapability, type Capability } from '@/src/shared/capabilities';
import type { ClockMode, TenantMode } from '@/src/shared/enums';
import type { DbCtx } from '@/src/db/types';
import { readCookie, SESSION_COOKIE, verifySession, type SessionPayload } from './session';

export interface Actor {
  kind: 'USER';
  userId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantMode: TenantMode;
  tenantTimezone: string;
  displayName: string;
  roleLabel: string;
  capabilities: Capability[];
}

/** Build the DB context for this actor. */
export function actorCtx(actor: Pick<Actor, 'tenantId' | 'userId'>, correlationId: string = randomUUID()): DbCtx {
  return { tenantId: actor.tenantId, userId: actor.userId, actorKind: 'USER', correlationId };
}

/** APP_MODE LIVE only serves LIVE tenants; DEMO/TEST only serve DEMO/TEST tenants. */
export function tenantModeAllowed(appMode: string, tenantMode: string): boolean {
  return appMode === 'LIVE' ? tenantMode === 'LIVE' : tenantMode === 'DEMO' || tenantMode === 'TEST';
}

interface ActorRow {
  user_id: string;
  display_name: string;
  role_label: string;
  capabilities: string[] | null;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_mode: TenantMode;
  tenant_timezone: string;
}

/** Load (user, tenant) from the DB; null if there is no ACTIVE membership. */
export async function loadActor(session: Pick<SessionPayload, 'uid' | 'tid'>, correlationId?: string): Promise<Actor | null> {
  const row = await withTx(
    { tenantId: session.tid, userId: session.uid, actorKind: 'USER', correlationId: correlationId ?? randomUUID() },
    async (c) => {
      const r = await c.query<ActorRow>(
        `SELECT u.id AS user_id, u.display_name, m.role_label, m.capabilities,
                t.id AS tenant_id, t.slug AS tenant_slug, t.name AS tenant_name,
                t.mode AS tenant_mode, t.timezone AS tenant_timezone
           FROM lumbung.memberships m
           JOIN lumbung.users u ON u.id = m.user_id
           JOIN lumbung.tenants t ON t.id = m.tenant_id
          WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.status = 'ACTIVE'`,
        [session.uid, session.tid],
      );
      return r.rows[0] ?? null;
    },
    { retries: 1 },
  );
  if (!row) return null;
  if (!tenantModeAllowed(getEnv().APP_MODE, row.tenant_mode)) return null;
  return {
    kind: 'USER',
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantName: row.tenant_name,
    tenantMode: row.tenant_mode,
    tenantTimezone: row.tenant_timezone,
    displayName: row.display_name,
    roleLabel: row.role_label,
    capabilities: (row.capabilities ?? []).filter(isCapability),
  };
}

async function actorFromToken(token: string | undefined, correlationId?: string): Promise<Actor | null> {
  if (!token) return null;
  const env = getEnv();
  const session = verifySession(token, { secret: env.SESSION_SECRET, now: new Date() });
  if (!session) return null;
  try {
    return await loadActor(session, correlationId);
  } catch (e) {
    // A DB outage must surface, but a malformed/foreign id simply means "no actor".
    const code = (e as { code?: string }).code;
    if (code === 'BAD_REQUEST' || code === 'NOT_FOUND') return null;
    throw e;
  }
}

/** For route handlers (reads the Cookie header of the Request). */
export async function getActor(request: Request, correlationId?: string): Promise<Actor | null> {
  return actorFromToken(readCookie(request.headers.get('cookie'), SESSION_COOKIE), correlationId);
}

/** For server components / layouts (uses next/headers). Deduplicated per request. */
export const getServerActor = cache(async (): Promise<Actor | null> => {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  return actorFromToken(store.get(SESSION_COOKIE)?.value);
});

export interface TenantClock {
  /** ISO instant of tenant_now() */
  now: string;
  mode: ClockMode;
}

/** Simulated (or real) tenant time for the clock pill; null if unavailable. */
export async function getTenantClock(actor: Pick<Actor, 'tenantId' | 'userId'>): Promise<TenantClock | null> {
  try {
    return await withTx(actorCtx(actor), async (c) => {
      const r = await c.query<{ now: Date; mode: ClockMode }>(
        `SELECT lumbung.tenant_now() AS now, c.mode
           FROM lumbung.tenant_clocks c
          WHERE c.tenant_id = $1`,
        [actor.tenantId],
      );
      const row = r.rows[0];
      return row ? { now: new Date(row.now).toISOString(), mode: row.mode } : null;
    });
  } catch (e) {
    console.warn('[lumbung] tenant clock unavailable:', (e as Error).message);
    return null;
  }
}

/** One entry of the demo login directory (/masuk). */
export interface DemoLoginEntry {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_mode: TenantMode;
  user_id: string;
  display_name: string;
  role_label: string;
}

/**
 * Staff users of DEMO/TEST tenants, via the SECURITY DEFINER function
 * `lumbung.demo_login_directory()` (W1-DB). Empty outside DEMO/TEST.
 */
export async function listDemoLogins(filter: { userId?: string } = {}): Promise<DemoLoginEntry[]> {
  if (!isDemoLike()) return [];
  return withTx({ tenantId: null, userId: null, actorKind: 'SYSTEM', correlationId: randomUUID() }, async (c) => {
    const r = await c.query<DemoLoginEntry>(
      `SELECT tenant_id, tenant_slug, tenant_name, tenant_mode, user_id, display_name, role_label
         FROM lumbung.demo_login_directory()
        WHERE ($1::uuid IS NULL OR user_id = $1::uuid)
        ORDER BY tenant_slug COLLATE "C", display_name COLLATE "C"`,
      [filter.userId ?? null],
    );
    return r.rows.filter((e) => e.tenant_mode === 'DEMO' || e.tenant_mode === 'TEST');
  });
}
