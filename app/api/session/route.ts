/**
 * Demo session (architecture G.4).
 *   POST   { user_id, tenant_id? }  DEMO/TEST only → sets lb_session
 *   DELETE                          → clears lb_session
 *   GET                             → { data: actor | null }
 */
import { z } from 'zod';
import { getEnv, isDemoLike } from '@/src/config/env';
import { DomainError } from '@/src/db/errors';
import { handler } from '@/src/http/handler';
import { listDemoLogins, loadActor } from '@/src/security/actor';
import { SESSION_COOKIE, serializeCookie, sessionCookieOptions, signSession } from '@/src/security/session';

const postBody = z.object({
  user_id: z.uuid(),
  /** Only needed when one user belongs to several demo tenants. */
  tenant_id: z.uuid().optional(),
});

/** Reject cross-site form posts (login CSRF); SameSite=Lax covers the rest. */
function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  let same = false;
  try {
    // Next may normalise request.url to its internal hostname. APP_BASE_URL is
    // the configured public origin; do not trust forwarded-host headers here.
    same = new URL(origin).origin === new URL(getEnv().APP_BASE_URL).origin;
  } catch {
    same = false;
  }
  if (!same) throw new DomainError({ code: 'FORBIDDEN', message: 'Cross-origin request refused' });
}

export const POST = handler({ auth: 'none', body: postBody }, async ({ request, body, correlationId, ok }) => {
  assertSameOrigin(request);
  if (!isDemoLike()) throw new DomainError({ code: 'DEMO_ONLY', message: 'Demo sign-in is disabled in LIVE mode' });

  const entries = await listDemoLogins({ userId: body.user_id });
  const entry = body.tenant_id ? entries.find((e) => e.tenant_id === body.tenant_id) : entries[0];
  if (!entry) throw new DomainError({ code: 'NOT_FOUND', message: 'User not available for demo sign-in' });

  // Re-load through the tenant-scoped path: ACTIVE membership + capabilities from the DB.
  const actor = await loadActor({ uid: entry.user_id, tid: entry.tenant_id }, correlationId);
  if (!actor) throw new DomainError({ code: 'NOT_FOUND', message: 'User not available for demo sign-in' });

  const env = getEnv();
  const token = signSession({ uid: actor.userId, tid: actor.tenantId }, { secret: env.SESSION_SECRET, now: new Date() });
  return ok(
    {
      user_id: actor.userId,
      tenant_id: actor.tenantId,
      display_name: actor.displayName,
      role_label: actor.roleLabel,
      capabilities: actor.capabilities,
    },
    { headers: { 'set-cookie': serializeCookie(SESSION_COOKIE, token, sessionCookieOptions(env.APP_BASE_URL)) } },
  );
});

export const DELETE = handler({ auth: 'none' }, async ({ request, ok }) => {
  assertSameOrigin(request);
  const env = getEnv();
  return ok(
    { signed_out: true },
    { headers: { 'set-cookie': serializeCookie(SESSION_COOKIE, '', sessionCookieOptions(env.APP_BASE_URL, 0)) } },
  );
});

export const GET = handler({ auth: 'optional' }, async ({ actor }) => {
  if (!actor) return null;
  return {
    user_id: actor.userId,
    tenant_id: actor.tenantId,
    tenant_slug: actor.tenantSlug,
    tenant_name: actor.tenantName,
    tenant_mode: actor.tenantMode,
    display_name: actor.displayName,
    role_label: actor.roleLabel,
    capabilities: actor.capabilities,
  };
});
