import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTenant } from '@/db/seed';
import { entityId, tenantNamespace } from '@/src/lib/uuidv5';
import type { DbCtx } from '@/src/db/types';
import { closeOwnerPool, ownerPool, withAppTx, withOwner } from '../setup/db-helpers';

const slug = `volunteer-${randomBytes(4).toString('hex')}`;
let tenantId: string;
let routeId: string;
const users = {
  one: entityId(tenantNamespace(slug), 'user', 'VOL1'),
  two: entityId(tenantNamespace(slug), 'user', 'VOL2'),
};

const ctx = (userId: string): DbCtx => ({
  tenantId,
  userId,
  actorKind: 'USER',
  correlationId: randomUUID(),
});

async function command(userId: string, action: string, expectedRevision: number) {
  return withAppTx(ctx(userId), async (c) => (await c.query<{ result: { state: string; revision: number; volunteer_user_id: string | null } }>(
    `SELECT lumbung.volunteer_command($1,$2,$3::jsonb,$4,$5) AS result`,
    [action, routeId, JSON.stringify({ expected_revision: expectedRevision }), randomUUID(), 'test-request'],
  )).rows[0].result);
}

beforeAll(async () => {
  const seeded = await seedTenant(ownerPool(), { slug, mode: 'TEST', expected: 'skip' });
  tenantId = seeded.tenantId;
  routeId = await withOwner(async (c) => (await c.query<{ id: string }>(
    `SELECT id FROM lumbung.volunteer_routes WHERE tenant_id=$1 AND state='OPEN' ORDER BY id LIMIT 1`,
    [tenantId],
  )).rows[0].id);
}, 120_000);

afterAll(async () => {
  await withOwner((c) => c.query(`SELECT lumbung.demo_reset_begin($1)`, [slug]));
  await closeOwnerPool();
}, 120_000);

describe('volunteer route command', () => {
  it('allows exactly one volunteer to claim an open route', async () => {
    const outcomes = await Promise.allSettled([
      command(users.one, 'claim', 1),
      command(users.two, 'claim', 1),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const row = await withOwner(async (c) => (await c.query<{ volunteer_user_id: string; state: string; revision: number }>(
      `SELECT volunteer_user_id,state,revision FROM lumbung.volunteer_routes WHERE tenant_id=$1 AND id=$2`,
      [tenantId, routeId],
    )).rows[0]);
    expect(row).toMatchObject({ state: 'CLAIMED', revision: 2 });
    expect([users.one, users.two]).toContain(row.volunteer_user_id);

    const loser = row.volunteer_user_id === users.one ? users.two : users.one;
    await expect(command(loser, 'start', 2)).rejects.toMatchObject({ code: 'ROUTE_NOT_ASSIGNED' });
    await expect(command(row.volunteer_user_id, 'start', 2)).resolves.toMatchObject({ state: 'EN_ROUTE_TO_PICKUP', revision: 3 });
  });
});
