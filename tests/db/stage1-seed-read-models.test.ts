/**
 * Stage 1 integration over the FULL deterministic seed (AC01 classifier as seen by the
 * app, AC40 read paths): the FLO directory, FLO detail, dashboard and settings read
 * models run as lumbung_app under RLS against a freshly seeded tenant and must agree
 * with the seed manifest. A second seeded tenant must see none of it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTenant, type SeedResult } from '@/db/seed';
import { getFlo, listFlos } from '@/src/application/flo/queries';
import { loadDashboard } from '@/src/application/dashboard/queries';
import { loadSettings } from '@/src/application/settings/queries';
import { ACTIVATION_DECISION_KEYS } from '@/src/shared/enums';
import { entityId, tenantNamespace } from '@/src/lib/uuidv5';
import type { DbCtx } from '@/src/db/types';
import { closeOwnerPool, ownerPool, withAppTx, withOwner } from '../setup/db-helpers';

const slugA = `s1int-a-${randomBytes(4).toString('hex')}`;
const slugB = `s1int-b-${randomBytes(4).toString('hex')}`;
let a: SeedResult;
let b: SeedResult;

const userId = (slug: string, key: string) => entityId(tenantNamespace(slug), 'user', key);
const floId = (slug: string, code: string) => entityId(tenantNamespace(slug), 'flo', code);
const ctx = (tenantId: string, slug: string, userKey: string): DbCtx => ({
  tenantId,
  userId: userId(slug, userKey),
  actorKind: 'USER',
  correlationId: `s1int-${userKey}`,
});

beforeAll(async () => {
  // 'skip': these are non-canonical slugs; the canonical manifest comparison is AC01's job.
  a = await seedTenant(ownerPool(), { slug: slugA, mode: 'DEMO', expected: 'skip' });
  b = await seedTenant(ownerPool(), { slug: slugB, mode: 'DEMO', expected: 'skip' });
}, 120_000);

afterAll(async () => {
  await withOwner(async (c) => {
    for (const s of [slugA, slugB]) {
      await c.query('SELECT lumbung.demo_reset_begin($1)', [s]);
    }
  });
  await closeOwnerPool();
}, 120_000);

describe('seeded tenant through the app read models (lumbung_app, RLS)', () => {
  it('the FLO directory shows 200 FLOs with agreement statuses equal to the AC01 classifier', async () => {
    const res = await withAppTx(ctx(a.tenantId, slugA, 'KOORD1'), (c) => listFlos(c, {}, { limit: 50 }));
    expect(res.tenant_total).toBe(200);
    expect(res.total).toBe(200);
    expect(res.items).toHaveLength(50);
    expect(res.next_cursor).not.toBeNull();
    expect(res.items[0].code).toBe('FLO-0001');
    const cls = a.manifest.counts.flos_by_agreement_class as Record<string, number>;
    expect(cls).toEqual({ ACTIVE_GT30: 140, EXPIRING: 25, EXPIRED: 25, PENDING: 10 });
    const k = res.agreement_counts;
    expect(k.ACTIVE).toBe(cls.ACTIVE_GT30);
    expect(k.EXPIRING_SOON).toBe(cls.EXPIRING);
    expect(k.EXPIRED).toBe(cls.EXPIRED);
    expect(k.PENDING + k.SCHEDULED + k.NONE + k.REVOKED).toBe(cls.PENDING);
    // NEW FLOs have no history: neutral 0.50 with zero samples.
    const all = [res.items];
    let cursor: string | null = res.next_cursor;
    while (cursor) {
      const at: string = cursor;
      const page = await withAppTx(ctx(a.tenantId, slugA, 'KOORD1'), (c) => listFlos(c, {}, { cursor: at, limit: 50 }));
      all.push(page.items);
      cursor = page.next_cursor;
    }
    const rows = all.flat();
    expect(rows).toHaveLength(200);
    expect(new Set(rows.map((r) => r.id)).size).toBe(200);
    const fresh = rows.filter((r) => r.tenure === 'NEW');
    expect(fresh).toHaveLength(20);
    for (const r of fresh) {
      expect(r.response).toMatchObject({ eligible: 0, band: 'INSUFFICIENT' });
      expect(r.reporting.n).toBe(0);
    }
  });

  it('the dashboard buckets equal the classifier', async () => {
    const d = await withAppTx(ctx(a.tenantId, slugA, 'KOORD1'), (c) => loadDashboard(c));
    expect(d.now).toBe('2026-10-26T01:00:00.000Z');
    expect(d.clockMode).toBe('FROZEN');
    expect(d.flo.total).toBe(200);
    const by = d.flo.byBucket;
    expect(by.ACTIVE).toBe(140);
    expect(by.EXPIRING).toBe(25);
    expect(by.EXPIRED).toBe(25);
    expect(by.PENDING + by.SCHEDULED + by.NONE).toBe(10);
    expect(d.review.pendingTotal).toBeGreaterThan(0);
  });

  it('FLO-0001 detail: expired agreement, contacts decrypt for flo.edit only', async () => {
    const id = floId(slugA, 'FLO-0001');
    const coord = await withAppTx(ctx(a.tenantId, slugA, 'KOORD1'), (c) => getFlo(c, id, { revealContacts: true }));
    expect(coord).not.toBeNull();
    expect(coord!.profile.code).toBe('FLO-0001');
    expect(coord!.summary.agreement.status).toBe('EXPIRED');
    expect(coord!.contacts.length).toBeGreaterThan(0);
    for (const ct of coord!.contacts) {
      expect(ct.decrypt_failed).toBe(false);
      expect(ct.address).toMatch(/^(sim:flo:0001|flo0001@example\.invalid)$/);
    }
    const auditor = await withAppTx(ctx(a.tenantId, slugA, 'AUDITOR'), (c) => getFlo(c, id, { revealContacts: false }));
    expect(auditor!.contacts.every((ct) => ct.address === null && ct.address_hint.length > 0)).toBe(true);
  });

  it('settings: all 10 activation decisions NOT_DECIDED, 7 policies, allocation weights, active flags', async () => {
    const s = await withAppTx(ctx(a.tenantId, slugA, 'ADMIN'), (c) => loadSettings(c, 'DEMO'));
    expect(s.decisions.map((d) => d.key).sort()).toEqual([...ACTIVATION_DECISION_KEYS].sort());
    expect(s.decisions.every((d) => d.status === 'NOT_DECIDED' && !d.live_enabled)).toBe(true);
    expect(s.policies).toHaveLength(7);
    expect(s.policies.every((p) => !p.live_allowed)).toBe(true);
    expect(s.policies.some((p) => p.is_active)).toBe(true);
    const alloc = s.policies.find((p) => p.kind === 'ALLOCATION');
    expect((alloc!.body as { weights?: Record<string, number> }).weights).toBeDefined();
  });

  it('another seeded tenant sees none of tenant A (directory, detail, dashboard)', async () => {
    const asB = ctx(b.tenantId, slugB, 'KOORD1');
    const list = await withAppTx(asB, (c) => listFlos(c, {}, { limit: 500 }));
    expect(list.tenant_total).toBe(200);
    const aIds = new Set(a.generated.flos.map((f) => f.id));
    expect(list.items.some((r) => aIds.has(r.id))).toBe(false);
    expect(await withAppTx(asB, (c) => getFlo(c, floId(slugA, 'FLO-0001')))).toBeNull();
    // A user of tenant A forging tenant B's context: RLS isolates by tenant (documented
    // limitation: the app credential can set any GUC; the app only derives the context from
    // a verified cookie + DB membership), and every command's require_ctx() refuses it.
    await expect(
      withAppTx(
        { tenantId: b.tenantId, userId: userId(slugA, 'KOORD1'), actorKind: 'USER', correlationId: 'forged' },
        (c) => c.query('SELECT lumbung.require_ctx()'),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the pre-login demo directory lists exactly the 10 seeded users per demo tenant', async () => {
    const rows = await withAppTx(
      { tenantId: null, userId: null, actorKind: 'SYSTEM', correlationId: 'dir' },
      (c) =>
        c.query<{ tenant_slug: string; display_name: string; role_label: string; tenant_mode: string }>(
          `SELECT tenant_slug, display_name, role_label, tenant_mode FROM lumbung.demo_login_directory()
            WHERE tenant_slug = ANY($1) ORDER BY tenant_slug, display_name`,
          [[slugA, slugB]],
        ),
    );
    const forA = rows.rows.filter((r) => r.tenant_slug === slugA);
    expect(forA.map((r) => r.display_name)).toEqual([
      'Admin Demo',
      'Auditor Demo',
      'Gudang Demo 1',
      'Gudang Demo 2',
      'Koordinator Demo 1',
      'Koordinator Demo 2',
      'Peninjau Bukti Demo',
      'Peninjau Perjanjian Demo',
      'Relawan Mobil Demo',
      'Relawan Motor Demo',
    ]);
    expect(rows.rows.every((r) => r.tenant_mode === 'DEMO')).toBe(true);
  });
});
