/**
 * Named fixtures FLO-0001..FLO-0011 (architecture B.2), routing fixtures, the SC01 and
 * AC48 "today" orders.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generateSeed, type GeneratedSeed } from '@/db/seed/generate';
import { FLO_FIXTURES } from '@/db/seed/fixtures';
import { FIXTURE_PLACEMENTS, ROUTING_FIXTURES, routingFixture } from '@/db/seed/routing-fixtures';
import { haversine } from '@/src/lib/geo';
import type { Row } from '@/db/seed/dataset';

let g: GeneratedSeed;
const T = Date.parse('2026-10-26T01:00:00Z');
const DAY = 86_400_000;

beforeAll(() => {
  g = generateSeed();
});

const rows = (t: Parameters<GeneratedSeed['ds']['rows']>[0]): Row[] => g.ds.rows(t);
const flo = (code: string) => g.flos.find((f) => f.code === code)!;
const byId = <T extends Row>(t: Parameters<GeneratedSeed['ds']['rows']>[0]) => new Map(rows(t).map((r) => [r.id as string, r as T]));
const catId = (code: string) => rows('categories').find((c) => c.code === code)!.id;
const agreementsOf = (code: string) => rows('agreements').filter((a) => a.flo_id === flo(code).id);

describe('named FLO fixtures', () => {
  it('fixture table covers FLO-0001..FLO-0011 at indices 0..10', () => {
    expect(FLO_FIXTURES.map((f) => f.code)).toEqual(Array.from({ length: 11 }, (_, i) => `FLO-${String(i + 1).padStart(4, '0')}`));
    FLO_FIXTURES.forEach((f, i) => expect(f.index).toBe(i));
  });

  it('every pinned attribute holds', () => {
    for (const fx of FLO_FIXTURES) {
      const f = flo(fx.code);
      if (fx.area) expect(f.area, fx.code).toBe(fx.area);
      if (fx.clusterCode) expect(f.cluster, fx.code).toBe(fx.clusterCode);
      if (fx.agreement) expect(f.agreementClass, fx.code).toBe(fx.agreement);
      if (fx.tenure) expect(f.tenure, fx.code).toBe(fx.tenure);
      if (fx.contact) expect(f.contact, fx.code).toBe(fx.contact);
      if (fx.reporting) expect(f.reporting, fx.code).toBe(fx.reporting);
    }
  });

  it('SC01 set: FLO-0001..0005 in Sunter (Demo), BREAD preferred; FLO-0001 expired and geographically closest to the bakery', () => {
    const src = rows('source_locations').find((s) => s.code === 'SRC-001')!;
    expect(rows('donors').find((d) => d.id === src.donor_id)!.name).toBe('Toko Roti Simulasi Sunter');
    const sunter = rows('clusters').find((c) => c.code === 'CL-JKT-01')!;
    expect(sunter.name).toBe('Sunter (Demo)');
    expect(src.cluster_id).toBe(sunter.id);
    const sLat = Number(src.lat);
    const sLng = Number(src.lng);
    const dist = g.flos.map((f) => ({ code: f.code, d: haversine(sLat, sLng, f.lat, f.lng) })).sort((a, b) => a.d - b.d);
    expect(dist[0].code).toBe('FLO-0001');
    expect(flo('FLO-0001').agreementClass).toBe('EXPIRED');
    for (const code of ['FLO-0001', 'FLO-0002', 'FLO-0003', 'FLO-0004', 'FLO-0005']) {
      expect(flo(code).cluster).toBe('CL-JKT-01');
      const pref = rows('flo_category_prefs').find((p) => p.flo_id === flo(code).id && p.category_id === catId('BREAD'));
      expect(pref?.preference, code).toBe('PREFER');
      expect(rows('category_demands').some((d) => d.flo_id === flo(code).id && d.category_id === catId('BREAD')), code).toBe(true);
    }
  });

  it('FLO-0001 need 95 fast/good; FLO-0003 need 90 + BREAD capacity 60 fast/good; FLO-0004 capacity 40 ordinary', () => {
    const need = (code: string) => rows('need_assessments').find((n) => n.flo_id === flo(code).id && n.category_id === catId('BREAD'))!;
    const cap = (code: string) => rows('flo_category_capacities').find((c) => c.flo_id === flo(code).id && c.category_id === catId('BREAD'))!;
    expect(need('FLO-0001')).toMatchObject({ score: '95.00', status: 'CONFIRMED' });
    expect(need('FLO-0003')).toMatchObject({ score: '90.00', status: 'CONFIRMED' });
    expect(Date.parse(need('FLO-0003').assessed_at as string)).toBeGreaterThan(T - 30 * DAY);
    expect(cap('FLO-0003')).toMatchObject({ per_event_capacity: '60', unit: 'portion' });
    expect(cap('FLO-0004')).toMatchObject({ per_event_capacity: '40', unit: 'portion' });
    expect(flo('FLO-0003')).toMatchObject({ contact: 'FAST', reporting: 'GOOD' });
    expect(flo('FLO-0004').contact).toBe('ORDINARY');
  });

  it('FLO-0002 has a BREAD receipt exactly at clock − 2 days and no later BREAD receipt; SC01 FLOs have no other recent BREAD history', () => {
    const dlines = byId('delivery_lines');
    const bread = catId('BREAD');
    const recentBread = rows('receipt_lines').filter(
      (r) => r.category_id === bread && Date.parse(r.received_at as string) >= T - 30 * DAY &&
        ['FLO-0001', 'FLO-0002', 'FLO-0003', 'FLO-0004', 'FLO-0005'].some((c) => flo(c).id === r.flo_id),
    );
    expect(recentBread).toHaveLength(1);
    expect(recentBread[0].flo_id).toBe(flo('FLO-0002').id);
    expect(recentBread[0].received_at).toBe('2026-10-24T01:00:00.000Z');
    expect(dlines.get(recentBread[0].delivery_line_id as string)).toBeDefined();
  });

  it('FLO-0005 (SC02) and FLO-0006 (SC06) are ACTIVE_GT30 in Jakarta', () => {
    expect(flo('FLO-0005')).toMatchObject({ area: 'JAKARTA', agreementClass: 'ACTIVE_GT30', cluster: 'CL-JKT-01' });
    expect(flo('FLO-0006')).toMatchObject({ area: 'JAKARTA', agreementClass: 'ACTIVE_GT30' });
  });

  it('FLO-0007 agreement valid through 2026-10-31 (exclusive end 2026-10-31T17:00Z)', () => {
    const approved = agreementsOf('FLO-0007').filter((a) => a.review_state === 'APPROVED');
    const current = approved.find((a) => Date.parse(a.valid_from as string) <= T && T < Date.parse(a.valid_until_exclusive as string))!;
    expect(current).toMatchObject({ valid_through_date: '2026-10-31', valid_until_exclusive: '2026-10-31T17:00:00.000Z' });
  });

  it('FLO-0008 has an expired agreement plus a PENDING_VERIFICATION renewal (AC04)', () => {
    const ags = agreementsOf('FLO-0008');
    expect(ags.some((a) => a.review_state === 'APPROVED' && Date.parse(a.valid_until_exclusive as string) <= T)).toBe(true);
    const pending = ags.filter((a) => a.review_state === 'PENDING_VERIFICATION');
    expect(pending).toHaveLength(1);
    expect(pending[0].reviewer_id).toBeNull();
    expect(flo('FLO-0008').agreementClass).toBe('EXPIRED');
  });

  it('FLO-0009/0010 are good reporters with history; FLO-0011 is NEW without any history', () => {
    for (const code of ['FLO-0009', 'FLO-0010']) {
      expect(flo(code)).toMatchObject({ reporting: 'GOOD', tenure: 'ESTABLISHED', agreementClass: 'ACTIVE_GT30' });
      expect(rows('flo_receipts').filter((r) => r.flo_id === flo(code).id).length, code).toBeGreaterThan(0);
    }
    const n = flo('FLO-0011');
    expect(n).toMatchObject({ tenure: 'NEW', contact: 'UNKNOWN', reporting: 'INSUFFICIENT', agreementClass: 'ACTIVE_GT30' });
    for (const t of ['offers', 'allocations', 'flo_receipts'] as const) expect(rows(t).filter((r) => r.flo_id === n.id)).toHaveLength(0);
  });
});

describe('routing fixtures', () => {
  it('fixture distances agree with stored coordinates (±0.05 km)', () => {
    const srcByCode = new Map(rows('source_locations').map((s) => [s.code as string, s]));
    for (const p of FIXTURE_PLACEMENTS) {
      const s = srcByCode.get(p.sourceCode)!;
      const f = flo(p.floCode);
      expect(Math.abs(haversine(Number(s.lat), Number(s.lng), f.lat, f.lng) - p.distanceKm), p.floCode).toBeLessThan(0.05);
    }
    for (const r of ROUTING_FIXTURES) {
      const p = FIXTURE_PLACEMENTS.find((x) => x.floCode === r.to && x.sourceCode === r.from)!;
      expect(r.distance_km).toBe(p.distanceKm);
      expect(r.minutes).toBeGreaterThan(0);
    }
    expect(routingFixture('SRC-001', 'FLO-0003')?.minutes).toBe(12);
    expect(routingFixture('SRC-001', 'FLO-0099')).toBeUndefined();
  });
});

describe('today orders', () => {
  const todayOrders = () =>
    rows('donation_orders').filter((o) => (o.code as string).startsWith('ORD-261026-'));

  it('six orders today in DRAFT/NEEDS_INFO/SAFETY_REVIEW/READY', () => {
    expect(todayOrders()).toHaveLength(6);
    expect(new Set(todayOrders().map((o) => o.operational_state))).toEqual(new Set(['DRAFT', 'NEEDS_INFO', 'SAFETY_REVIEW', 'READY']));
  });

  it('SC01 order: Roti Tawar 120 portion READY from Toko Roti Simulasi Sunter with a valid safety window', () => {
    const src = rows('source_locations').find((s) => s.code === 'SRC-001')!;
    const order = todayOrders().find((o) => o.source_location_id === src.id)!;
    expect(order.operational_state).toBe('READY');
    const item = rows('donation_items').find((i) => i.order_id === order.id)!;
    const product = rows('products').find((p) => p.id === item.product_id)!;
    expect(product.code).toBe('ROTI-TAWAR');
    expect(item).toMatchObject({ quantity: '120', unit: 'portion', safety_state: 'CLEARED' });
    const ev = rows('safety_evaluations').find((s) => s.subject_id === item.id)!;
    expect(ev.verdict).toBe('CLEARED');
    expect(Date.parse(ev.usable_until as string)).toBeGreaterThan(T + 4 * 3_600_000);
    // No warehouse movement / batch for the direct order.
    expect(rows('inventory_batches').some((b) => b.donor_order_id === order.id)).toBe(false);
  });

  it('AC48 order: unit tray with no conversion → NEEDS_INFO with missing_fields', () => {
    const item = rows('donation_items').find((i) => i.unit === 'tray')!;
    expect(item).toMatchObject({ conversion_id: null, safety_state: 'PENDING', missing_fields: ['unit_conversion'] });
    const order = rows('donation_orders').find((o) => o.id === item.order_id)!;
    expect(order.operational_state).toBe('NEEDS_INFO');
    expect(rows('unit_conversions').some((c) => c.from_unit === 'tray' || c.to_unit === 'tray')).toBe(false);
  });
});

describe('seeded agreement lifecycle mirrors the commands (0013/0015)', () => {
  const tasksOf = (agreementId: unknown) => rows('renewal_tasks').filter((t) => t.agreement_id === agreementId);

  it('FLO-0008: renewal tasks stay OPEN, linked to the pending renewal (only an approval closes them)', () => {
    const ags = agreementsOf('FLO-0008');
    const pending = ags.find((a) => a.review_state === 'PENDING_VERIFICATION')!;
    const current = ags.find((a) => a.review_state === 'APPROVED')!;
    const tasks = tasksOf(current.id);
    expect(tasks.map((t) => t.offset_days).sort()).toEqual([14, 30, 7]);
    for (const t of tasks) expect(t).toMatchObject({ status: 'OPEN', submitted_agreement_id: pending.id });
  });

  it('every approved version has its 30/14/7 tasks (incl. future due dates); DONE only with an approved successor', () => {
    const approved = rows('agreements').filter((a) => a.review_state === 'APPROVED');
    for (const a of approved) {
      const tasks = tasksOf(a.id);
      expect(tasks.map((t) => t.offset_days).sort(), String(a.id)).toEqual([14, 30, 7]);
      const until = Date.parse(a.valid_until_exclusive as string);
      for (const t of tasks) expect(Date.parse(t.due_at as string)).toBe(until - (t.offset_days as number) * DAY);
      const successor = rows('agreements').find(
        (s) => s.flo_id === a.flo_id && s.review_state === 'APPROVED' && s.id !== a.id && Date.parse(s.valid_from as string) >= Date.parse(a.valid_from as string) + 1 && Date.parse(s.valid_until_exclusive as string) >= until,
      );
      for (const t of tasks) {
        if (successor) expect(t, String(a.id)).toMatchObject({ status: 'DONE', submitted_agreement_id: successor.id });
        else expect(t.status, String(a.id)).toBe('OPEN');
      }
    }
    // ACTIVE_GT30 agreements get tasks that fall due later (materialised now, like approve_agreement).
    expect(rows('renewal_tasks').some((t) => Date.parse(t.due_at as string) > T && t.status === 'OPEN')).toBe(true);
    // EXPIRED FLOs without a renewal have all three tasks open and overdue.
    const expiredNoRenewal = g.flos.filter((f) => f.agreementClass === 'EXPIRED' && agreementsOf(f.code).every((a) => a.review_state !== 'PENDING_VERIFICATION'));
    expect(expiredNoRenewal.length).toBeGreaterThan(0);
    for (const f of expiredNoRenewal) {
      const open = agreementsOf(f.code)
        .filter((a) => a.superseded_from === null)
        .flatMap((a) => tasksOf(a.id))
        .filter((t) => t.status === 'OPEN' && Date.parse(t.due_at as string) <= T);
      expect(open, f.code).toHaveLength(3);
    }
  });

  it('an older overlapped version is capped at its successor’s start, not erased, and records its interpretation', () => {
    const capped = rows('agreements').filter((a) => a.superseded_from !== null);
    expect(capped.length).toBeGreaterThan(0);
    for (const a of capped) {
      expect(a.review_state).toBe('APPROVED');
      const successorId = g.ds.deferred.find((d) => d.table === 'agreements' && d.column === 'superseded_by_id')!.rows.find((r) => r.id === a.id)!.value;
      const successor = rows('agreements').find((s) => s.id === successorId)!;
      expect(a.superseded_from).toBe(successor.valid_from);
      expect(a.superseded_at).toBe(successor.reviewed_at);
    }
    for (const a of rows('agreements')) {
      expect(a).toMatchObject({ end_date_interpretation: 'THROUGH_INCLUSIVE', document_end_date: a.valid_through_date });
    }
  });
});
