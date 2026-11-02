/**
 * AC01 against the real database: seed → dump FLO identities/attributes + manifest →
 * protected reset → dump identical; exact marginals via the B.3 classifier in SQL
 * (agreement_valid_at at the clock); 200 FLOs; zero invariant violations; a second
 * tenant is untouched by the reset; LIVE refusals.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTenant, type SeedResult } from '@/db/seed';
import { AGREEMENT_CLASS_SQL, PEOPLE_BAND_SQL, readExpected } from '@/db/seed/manifest';
import { decryptContact } from '@/src/security/crypto';
import { makeTenant, ownerPool, withOwner, type TestTenant } from '../setup/db-helpers';

const CLOCK = '2026-10-26T01:00:00.000Z';
const slug = `seed-ac01-${randomBytes(4).toString('hex')}`;

let first: SeedResult;
let other: TestTenant;
let otherBefore: unknown;
let dumpBefore: Awaited<ReturnType<typeof dump>>;

async function dump(tenantId: string) {
  return withOwner(async (c) => {
    const q = async (sql: string) => (await c.query(sql, [tenantId])).rows;
    return {
      tenant: await q(`SELECT id, slug, mode, is_demo, timezone FROM lumbung.tenants WHERE id = $1`),
      flos: await q(`SELECT f.id, f.code, f.name, f.flo_type, f.service_model, f.status, f.area, f.lat::text, f.lng::text,
                            f.location_confidence, f.cooking_capable, f.storage_capabilities, f.halal_required,
                            f.allergen_exclusions, f.tenure, f.revision, cl.code AS cluster
                       FROM lumbung.flos f
                       JOIN lumbung.flo_clusters fc ON fc.tenant_id = f.tenant_id AND fc.flo_id = f.id AND fc.is_primary
                       JOIN lumbung.clusters cl ON cl.tenant_id = fc.tenant_id AND cl.id = fc.cluster_id
                      WHERE f.tenant_id = $1 ORDER BY f.code`),
      schedules: await q(`SELECT id, flo_id, people_per_event, count_basis, service_dows, verified_count FROM lumbung.service_schedules WHERE tenant_id = $1 ORDER BY id`),
      agreements: await q(`SELECT id, flo_id, version, valid_from_date, valid_through_date, valid_from, valid_until_exclusive, review_state, supersedes_id
                             FROM lumbung.agreements WHERE tenant_id = $1 ORDER BY id`),
      contacts: await q(`SELECT id, flo_id, channel, address_hint, consent_state FROM lumbung.flo_contacts WHERE tenant_id = $1 ORDER BY id`),
      users: await q(`SELECT u.id, u.display_name, u.email, m.role_label, m.capabilities FROM lumbung.memberships m
                        JOIN lumbung.users u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY u.id`),
      history: await q(`SELECT md5(string_agg(a.id || ':' || a.code || ':' || a.state || ':' || a.quantity || ':' || a.flo_id, ',' ORDER BY a.id)) AS allocations,
                               (SELECT md5(string_agg(r.id || ':' || r.received_at, ',' ORDER BY r.id)) FROM lumbung.flo_receipts r WHERE r.tenant_id = $1) AS receipts,
                               (SELECT md5(string_agg(b.batch_id || ':' || b.account || ':' || b.qty, ',' ORDER BY b.batch_id, b.account))
                                  FROM lumbung.batch_balances b WHERE b.tenant_id = $1) AS balances,
                               (SELECT md5(string_agg(o.id || ':' || o.state || ':' || o.due_at, ',' ORDER BY o.id))
                                  FROM lumbung.evidence_obligations o WHERE o.tenant_id = $1) AS obligations
                          FROM lumbung.allocations a WHERE a.tenant_id = $1`),
      manifest: await q(`SELECT id, seed::text, clock, schema_version, counts, created_at FROM lumbung.seed_manifests WHERE tenant_id = $1`),
    };
  });
}

async function snapshotOther(t: TestTenant) {
  return withOwner(async (c) => ({
    tenant: (await c.query(`SELECT * FROM lumbung.tenants WHERE id = $1`, [t.id])).rows,
    clock: (await c.query(`SELECT * FROM lumbung.tenant_clocks WHERE tenant_id = $1`, [t.id])).rows,
    memberships: (await c.query(`SELECT * FROM lumbung.memberships WHERE tenant_id = $1 ORDER BY id`, [t.id])).rows,
    users: (await c.query(`SELECT u.* FROM lumbung.users u JOIN lumbung.memberships m ON m.user_id = u.id WHERE m.tenant_id = $1 ORDER BY u.id`, [t.id])).rows,
  }));
}

const grouped = async (sql: string, params: unknown[]) =>
  withOwner(async (c) => {
    const { rows } = await c.query<{ k: string; n: number }>(sql, params);
    return Object.fromEntries(rows.map((r) => [r.k, r.n]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)));
  });

beforeAll(async () => {
  other = await makeTenant(ownerPool(), { mode: 'TEST' });
  otherBefore = await snapshotOther(other);
  first = await seedTenant(ownerPool(), { slug, name: 'FoodCycle Demo (uji AC01)', mode: 'DEMO' });
  dumpBefore = await dump(first.tenantId);
}, 120_000);

afterAll(async () => {
  await withOwner((c) => c.query(`SELECT lumbung.demo_reset_begin($1)`, [slug]));
});

describe('AC01 seed determinism (database)', () => {
  it('seeds 200 FLOs with zero invariant violations and the committed manifest counts', async () => {
    expect(first.slug).toBe(slug);
    const counts = first.manifest.counts as Record<string, unknown>;
    expect(counts.flos).toBe(200);
    const v = await withOwner((c) => c.query(`SELECT * FROM lumbung.verify_tenant_invariants($1)`, [first.tenantId]));
    expect(v.rows).toEqual([]);
    const expected = readExpected();
    expect(expected, 'db/seed/expected-manifest.json must be committed').not.toBeNull();
    expect(first.expected).toBe('MATCHED');
    expect(counts).toEqual(expected!.counts);
    expect(first.manifest).toMatchObject({ seed: 20261026, clock: CLOCK });
    expect(dumpBefore.manifest).toHaveLength(1);
  });

  it('exact marginals by SQL (B.3 classifier via agreement_valid_at at the clock)', async () => {
    const t = first.tenantId;
    expect(await grouped(`SELECT agreement_class AS k, count(*)::int AS n FROM (${AGREEMENT_CLASS_SQL}) x GROUP BY 1`, [t, CLOCK])).toEqual({
      ACTIVE_GT30: 140, EXPIRED: 25, EXPIRING: 25, PENDING: 10,
    });
    expect(await grouped(`SELECT area AS k, count(*)::int AS n FROM lumbung.flos WHERE tenant_id = $1 GROUP BY 1`, [t])).toEqual({
      BEKASI: 30, BOGOR: 35, DEPOK: 25, JAKARTA: 70, TANGERANG: 40,
    });
    expect(await grouped(`SELECT flo_type AS k, count(*)::int AS n FROM lumbung.flos WHERE tenant_id = $1 GROUP BY 1`, [t])).toEqual({
      NON_PANTI: 90, PANTI: 110,
    });
    expect(await grouped(`SELECT band AS k, count(*)::int AS n FROM (${PEOPLE_BAND_SQL}) x GROUP BY 1`, [t])).toEqual({
      B10_30: 50, B201_500: 20, B31_80: 80, B81_200: 50,
    });
    expect(await grouped(`SELECT tenure AS k, count(*)::int AS n FROM lumbung.flos WHERE tenant_id = $1 GROUP BY 1`, [t])).toEqual({
      ESTABLISHED: 180, NEW: 20,
    });
    // The pure generator's latent contact / reporting profiles match PRD §24 exactly.
    const tally = (k: 'contact' | 'reporting') =>
      first.generated.flos.reduce<Record<string, number>>((m, f) => ((m[f[k]] = (m[f[k]] ?? 0) + 1), m), {});
    expect(tally('contact')).toEqual({ FAST: 70, ORDINARY: 70, SLOW: 40, UNKNOWN: 20 });
    expect(tally('reporting')).toEqual({ GOOD: 90, MIXED: 60, POOR: 30, INSUFFICIENT: 20 });
  });

  it('volumes: 600 allocations, 500 with accepted receipt, 100 without', async () => {
    const t = first.tenantId;
    const r = await withOwner(async (c) =>
      (
        await c.query(
          `SELECT (SELECT count(*)::int FROM lumbung.allocations WHERE tenant_id = $1) AS allocations,
                  (SELECT count(DISTINCT dl.allocation_id)::int FROM lumbung.receipt_lines rl
                     JOIN lumbung.delivery_lines dl ON dl.tenant_id = rl.tenant_id AND dl.id = rl.delivery_line_id
                    WHERE rl.tenant_id = $1 AND rl.is_current AND rl.accepted_qty > 0) AS with_receipt,
                  (SELECT count(*)::int FROM lumbung.donation_orders WHERE tenant_id = $1) AS orders,
                  (SELECT count(*)::int FROM lumbung.inventory_batches WHERE tenant_id = $1) AS batches,
                  (SELECT count(*)::int FROM lumbung.expected_inbounds WHERE tenant_id = $1) AS inbounds,
                  (SELECT count(*)::int FROM lumbung.distribution_events WHERE tenant_id = $1) AS events,
                  (SELECT count(*)::int FROM lumbung.stock_movements m
                     JOIN lumbung.movement_entries e ON e.tenant_id = m.tenant_id AND e.movement_id = m.id
                     JOIN lumbung.inventory_batches b ON b.tenant_id = e.tenant_id AND b.id = e.batch_id
                     JOIN lumbung.donation_orders o ON o.tenant_id = b.tenant_id AND o.id = b.donor_order_id
                    WHERE m.tenant_id = $1 AND o.route = 'DIRECT') AS direct_movements`,
          [t],
        )
      ).rows[0],
    );
    expect(r).toEqual({ allocations: 600, with_receipt: 500, orders: 300, batches: 120, inbounds: 80, events: 120, direct_movements: 0 });
  });

  it('fixtures hold in the database (closest expired FLO, recent bread, NEW without history)', async () => {
    const t = first.tenantId;
    const rows = await withOwner(async (c) => {
      const closest = await c.query(
        `SELECT f.code FROM lumbung.flos f, lumbung.source_locations s
          WHERE f.tenant_id = $1 AND s.tenant_id = $1 AND s.code = 'SRC-001'
          ORDER BY (f.lat - s.lat) ^ 2 + ((f.lng - s.lng) * cos(radians(s.lat))) ^ 2 LIMIT 1`,
        [t],
      );
      const fixtureClass = await c.query(`SELECT code, agreement_class FROM (${AGREEMENT_CLASS_SQL}) x WHERE code IN ('FLO-0001','FLO-0007','FLO-0008','FLO-0011') ORDER BY code`, [t, CLOCK]);
      const bread = await c.query(
        `SELECT r.received_at FROM lumbung.flo_receipts r JOIN lumbung.flos f ON f.tenant_id = r.tenant_id AND f.id = r.flo_id
          JOIN lumbung.receipt_lines rl ON rl.tenant_id = r.tenant_id AND rl.receipt_id = r.id
          JOIN lumbung.categories cat ON cat.tenant_id = rl.tenant_id AND cat.id = rl.category_id
         WHERE r.tenant_id = $1 AND f.code = 'FLO-0002' AND cat.code = 'BREAD' ORDER BY r.received_at DESC LIMIT 1`,
        [t],
      );
      const newHistory = await c.query(
        `SELECT (SELECT count(*)::int FROM lumbung.offers o JOIN lumbung.flos f ON f.tenant_id = o.tenant_id AND f.id = o.flo_id WHERE o.tenant_id = $1 AND f.tenure = 'NEW')
              + (SELECT count(*)::int FROM lumbung.flo_receipts r JOIN lumbung.flos f ON f.tenant_id = r.tenant_id AND f.id = r.flo_id WHERE r.tenant_id = $1 AND f.tenure = 'NEW') AS n`,
        [t],
      );
      const monthEnd = await c.query(
        `SELECT lumbung.agreement_valid_at_for($1, f.id, '2026-10-31T16:59:59.999Z') IS NOT NULL AS before_end,
                lumbung.agreement_valid_at_for($1, f.id, '2026-10-31T17:00:00Z') IS NULL AS at_end
           FROM lumbung.flos f WHERE f.tenant_id = $1 AND f.code = 'FLO-0007'`,
        [t],
      );
      return { closest: closest.rows[0].code, fixtureClass: fixtureClass.rows, bread: bread.rows[0], newHistory: newHistory.rows[0].n, monthEnd: monthEnd.rows[0] };
    });
    expect(rows.closest).toBe('FLO-0001');
    expect(rows.fixtureClass).toEqual([
      { code: 'FLO-0001', agreement_class: 'EXPIRED' },
      { code: 'FLO-0007', agreement_class: 'EXPIRING' },
      { code: 'FLO-0008', agreement_class: 'EXPIRED' },
      { code: 'FLO-0011', agreement_class: 'ACTIVE_GT30' },
    ]);
    expect((rows.bread.received_at as Date).toISOString()).toBe('2026-10-24T01:00:00.000Z');
    expect(rows.newHistory).toBe(0);
    expect(rows.monthEnd).toEqual({ before_end: true, at_end: true });
  });

  it('contact addresses are encrypted at rest (sim:flo:NNNN, example.invalid) with masked hints', async () => {
    const r = await withOwner((c) =>
      c.query<{ channel: string; address_ciphertext: Buffer; address_hint: string }>(
        `SELECT fc.channel, fc.address_ciphertext, fc.address_hint FROM lumbung.flo_contacts fc
           JOIN lumbung.flos f ON f.tenant_id = fc.tenant_id AND f.id = fc.flo_id
          WHERE fc.tenant_id = $1 AND f.code = 'FLO-0042' ORDER BY fc.channel`,
        [first.tenantId],
      ),
    );
    expect(r.rows.map((x) => x.channel)).toEqual(['EMAIL', 'SIM']);
    const plain = r.rows.map((x) => decryptContact(x.address_ciphertext));
    expect(plain).toEqual(['flo0042@example.invalid', 'sim:flo:0042']);
    for (const x of r.rows) {
      expect(x.address_ciphertext.toString('utf8')).not.toContain('0042');
      expect(x.address_hint).toContain('*');
    }
  });

  it('protected reset reconstructs identical identities, attributes and history; second tenant untouched', async () => {
    const second = await seedTenant(ownerPool(), { slug, name: 'FoodCycle Demo (uji AC01)', mode: 'DEMO', reset: true });
    expect(second.resetTenantId).toBe(first.tenantId);
    expect(second.tenantId).toBe(first.tenantId);
    const dumpAfter = await dump(second.tenantId);
    expect(dumpAfter).toEqual(dumpBefore);
    expect(second.manifest).toEqual(first.manifest);
    expect(await snapshotOther(other)).toEqual(otherBefore);
  }, 120_000);

  it('refuses unsafe seeds: existing tenant without reset, LIVE tenant reset, APP_MODE=LIVE', async () => {
    await expect(seedTenant(ownerPool(), { slug })).rejects.toThrow(/already exists/);
    const live = await makeTenant(ownerPool(), { mode: 'LIVE' });
    await expect(seedTenant(ownerPool(), { slug: live.slug, reset: true })).rejects.toThrow(/Refusing to reset/);
    await expect(withOwner((c) => c.query(`SELECT lumbung.demo_reset_begin($1)`, [live.slug]))).rejects.toThrow(/LB:RESET_FORBIDDEN/);
    const still = await withOwner((c) => c.query(`SELECT count(*)::int AS n FROM lumbung.tenants WHERE id = $1`, [live.id]));
    expect(still.rows[0].n).toBe(1);
    const prev = process.env.APP_MODE;
    process.env.APP_MODE = 'LIVE';
    try {
      await expect(seedTenant(ownerPool(), { slug: `seed-live-${randomBytes(3).toString('hex')}` })).rejects.toThrow(/APP_MODE=LIVE/);
    } finally {
      process.env.APP_MODE = prev;
    }
  });
});
