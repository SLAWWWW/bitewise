/**
 * GET /api/health — web process health. No session, no tenant data.
 *
 *   200 { data: { status: 'ok', mode, db: { ok: true, latency_ms }, schema: {...} } }
 *   503 { data: { status: 'unavailable', mode, db: { ok: false, error }, schema: null } }
 *
 * The DB probe is a trivial query on the app role (DATABASE_URL, lumbung_app) without
 * any tenant context, so RLS keeps every tenant table invisible to it. The schema version
 * is the highest applied migration; see src/application/settings/health.ts for how it is
 * read without granting the app role access to `schema_migrations`.
 */
import { handler } from '@/src/http/handler';
import { checkHealth } from '@/src/application/settings/health';

export const GET = handler({ auth: 'none' }, async ({ ok, correlationId }) => {
  const h = await checkHealth(correlationId);
  return ok(h, { status: h.status === 'ok' ? 200 : 503 });
});
