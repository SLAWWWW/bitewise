/**
 * GET /api/health against the real per-run test database (app role).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { configureDb } from '@/src/db/pool';
import { expectedMigration } from '@/src/application/settings/health';
import * as health from '@/app/api/health/route';
import { appUrl, makeTenant, ownerPool } from '../setup/db-helpers';

async function getHealth() {
  const res = await health.GET(new Request('http://x/api/health'));
  return { res, body: (await res.json()) as { data: Record<string, unknown>; correlation_id: string } };
}

describe('GET /api/health', () => {
  afterAll(async () => {
    await configureDb({ connectionString: appUrl(), max: 5 });
  });

  it('is ok with the DB reachable on the app role, reports mode and the shipped schema version', async () => {
    const { res, body } = await getHealth();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.correlation_id).toEqual(expect.any(String));
    const d = body.data as {
      status: string;
      mode: string;
      db: { ok: boolean; latency_ms: number };
      schema: { applied: unknown; source: string; expected: { version: number; name: string }; up_to_date: unknown };
    };
    expect(d.status).toBe('ok');
    expect(d.mode).toBe('TEST');
    expect(d.db.ok).toBe(true);
    expect(d.db.latency_ms).toBeGreaterThanOrEqual(0);
    const expected = expectedMigration();
    expect(expected).not.toBeNull();
    expect(d.schema.expected).toEqual(expected);

    // Applied version: readable by the app role via the 0014 column grant (version, name).
    const owner = await ownerPool().query<{ version: number; name: string }>(
      'SELECT version, name FROM lumbung.schema_migrations ORDER BY version DESC LIMIT 1',
    );
    expect(d.schema.source).toBe('table');
    expect(d.schema.applied).toEqual(owner.rows[0]);
    expect(d.schema.up_to_date).toBe(true);
  });

  it('needs no session and leaks no tenant data', async () => {
    const t = await makeTenant();
    const { res, body } = await getHealth();
    expect(res.status).toBe(200);
    const text = JSON.stringify(body);
    expect(text).not.toContain(t.id);
    expect(text).not.toContain(t.slug);
    expect(Object.keys(body.data).sort()).toEqual(['db', 'mode', 'schema', 'status']);
  });

  it('returns 503 when the database is unreachable', async () => {
    await configureDb({ connectionString: 'postgres://lumbung_app:lumbung_app@127.0.0.1:1/lumbung', max: 1 });
    const { res, body } = await getHealth();
    expect(res.status).toBe(503);
    expect(body.data).toMatchObject({ status: 'unavailable', mode: 'TEST', db: { ok: false }, schema: null });
    await configureDb({ connectionString: appUrl(), max: 5 });
    const again = await getHealth();
    expect(again.res.status).toBe(200);
  });
});
