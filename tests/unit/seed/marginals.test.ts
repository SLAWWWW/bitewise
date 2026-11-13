/**
 * AC01 (pure generator): exact PRD §24 marginals and volumes, swap enforcement keeps
 * multisets, NEW FLOs have no history.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generateSeed, type GeneratedSeed } from '@/db/seed/generate';
import {
  AGREEMENT_COUNTS,
  AREA_COUNTS,
  CONTACT_COUNTS,
  PEOPLE_BAND_COUNTS,
  REPORTING_COUNTS,
  TENURE_COUNTS,
  TYPE_COUNTS,
  countBy,
  enforceBySwap,
  labelMultiset,
  sameMultiset,
} from '@/db/seed/marginals';
import type { Row } from '@/db/seed/dataset';

let g: GeneratedSeed;
beforeAll(() => {
  g = generateSeed();
});

const sorted = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort());
const rows = (t: Parameters<GeneratedSeed['ds']['rows']>[0]): Row[] => g.ds.rows(t);
const by = (t: Parameters<GeneratedSeed['ds']['rows']>[0], col: string) => sorted(countBy(rows(t), (r) => String(r[col])));

describe('seed marginals (PRD §24)', () => {
  it('has exactly 200 FLOs with codes FLO-0001..FLO-0200', () => {
    expect(g.flos).toHaveLength(200);
    expect(g.flos[0].code).toBe('FLO-0001');
    expect(g.flos[199].code).toBe('FLO-0200');
    expect(new Set(g.flos.map((f) => f.id)).size).toBe(200);
  });

  it.each([
    ['area', AREA_COUNTS],
    ['type', TYPE_COUNTS],
    ['band', PEOPLE_BAND_COUNTS],
    ['agreementClass', AGREEMENT_COUNTS],
    ['contact', CONTACT_COUNTS],
    ['reporting', REPORTING_COUNTS],
    ['tenure', TENURE_COUNTS],
  ] as const)('%s marginal is exact', (attr, counts) => {
    expect(sorted(countBy(g.flos, (f) => f[attr]))).toEqual(sorted({ ...counts }));
  });

  it('NEW FLOs are exactly the UNKNOWN contact / INSUFFICIENT reporting ones', () => {
    for (const f of g.flos) {
      expect(f.tenure === 'NEW').toBe(f.contact === 'UNKNOWN');
      expect(f.tenure === 'NEW').toBe(f.reporting === 'INSUFFICIENT');
    }
  });

  it('stored FLO rows carry the same area / type / tenure marginals and people in band', () => {
    expect(by('flos', 'area')).toEqual(sorted({ ...AREA_COUNTS }));
    expect(by('flos', 'flo_type')).toEqual(sorted({ ...TYPE_COUNTS }));
    expect(by('flos', 'tenure')).toEqual(sorted({ ...TENURE_COUNTS }));
    const bands: Record<string, [number, number]> = { B10_30: [10, 30], B31_80: [31, 80], B81_200: [81, 200], B201_500: [201, 500] };
    for (const f of g.flos) {
      const [lo, hi] = bands[f.band];
      expect(f.people).toBeGreaterThanOrEqual(lo);
      expect(f.people).toBeLessThanOrEqual(hi);
    }
  });
});

describe('seed volumes (PRD §24 / architecture B)', () => {
  it('reference data', () => {
    expect(rows('users')).toHaveLength(10);
    expect(rows('memberships')).toHaveLength(10);
    expect(rows('volunteer_profiles')).toHaveLength(2);
    expect(rows('clusters')).toHaveLength(20);
    expect(by('clusters', 'area')).toEqual({ BEKASI: 4, BOGOR: 3, DEPOK: 3, JAKARTA: 6, TANGERANG: 4 });
    expect(rows('categories')).toHaveLength(6);
    expect(rows('products')).toHaveLength(12);
    expect(rows('donors')).toHaveLength(30);
    expect(by('source_locations', 'kind')).toEqual({ DONOR_SITE: 40, WAREHOUSE: 2 });
    expect(rows('storage_locations')).toHaveLength(6);
    expect(rows('activation_decisions')).toHaveLength(10);
    expect(rows('activation_decisions').every((r) => r.status === 'NOT_DECIDED')).toBe(true);
    expect(rows('tenant_clocks')).toEqual([expect.objectContaining({ mode: 'FROZEN', sim_anchor: '2026-10-26T01:00:00.000Z' })]);
    expect(rows('tenants')[0]).toMatchObject({ slug: 'foodcycle-demo', name: 'FoodCycle Demo', mode: 'DEMO', is_demo: true });
  });

  it('policies', () => {
    const p = Object.fromEntries(rows('policy_versions').map((r) => [r.code as string, r]));
    expect(Object.keys(p).sort()).toEqual(
      ['ALLOC-DEMO-2.0', 'LOGISTICS-DEMO-1.0', 'OUTREACH-DEMO-1.0', 'REPORTING-DEMO-1.0', 'REPORTING-DEMO-24H', 'RETENTION-90D', 'SAFETY-DEMO-SYNTH-1.0'].sort(),
    );
    expect(p['SAFETY-DEMO-SYNTH-1.0'].status).toBe('APPROVED_DEMO');
    const alloc = p['ALLOC-DEMO-2.0'].body as { weights: Record<string, number>; max_travel_minutes: Record<string, number>; min_useful_qty: Record<string, unknown> };
    expect(Object.values(alloc.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(Object.keys(alloc.max_travel_minutes).sort()).toEqual(['BREAD', 'PREPARED_MEAL', 'PRODUCE', 'RICE', 'SNACK', 'STAPLE']);
    expect(Object.keys(alloc.min_useful_qty)).toHaveLength(6);
    expect((p['REPORTING-DEMO-1.0'].body as { due_rules: Record<string, string> }).due_rules.RECEIPT_PHOTO).toBe('CALENDAR_NEXT_DAY_EOD');
    expect((p['REPORTING-DEMO-24H'].body as { due_rules: Record<string, string> }).due_rules.RECEIPT_PHOTO).toBe('ROLLING_24H');
    const active = rows('tenant_active_policies').map((r) => r.policy_version_id);
    expect(active).not.toContain(p['REPORTING-DEMO-24H'].id);
    expect(active).toContain(p['REPORTING-DEMO-1.0'].id);
  });

  it('orders, allocations and receipts', () => {
    expect(rows('donation_orders')).toHaveLength(300);
    expect(by('donation_orders', 'route')).toEqual({ DIRECT: 220, WAREHOUSE_INBOUND: 80 });
    expect(rows('allocations')).toHaveLength(600);
    expect(by('allocations', 'source_type')).toEqual({ BATCH: 150, DIRECT_ITEM: 450 });
    expect(by('allocations', 'state')).toEqual({
      ACCEPTED_RESERVED: 5,
      APPROVED: 3,
      AWAITING_FINAL_APPROVAL: 4,
      CANCELLED: 50,
      DISPATCHED: 4,
      EXPIRED: 25,
      LOGISTICS_PENDING: 4,
      OFFER_HELD: 5,
      PARTIALLY_RECEIVED: 40,
      RECEIVED: 460,
    });
    const cancel = countBy(rows('allocations').filter((r) => r.cancel_reason), (r) => String(r.cancel_reason).split(':')[0]);
    expect(cancel).toEqual({ DECLINED: 30, DONOR_WITHDRAWN: expect.any(Number), STAFF_CANCELLED: expect.any(Number), LOGISTICS_FEE_REFUSED: 10 });
    expect(cancel.DONOR_WITHDRAWN + cancel.STAFF_CANCELLED).toBe(10);
    expect(rows('allocations').filter((r) => r.cancel_reason === 'DECLINED:FEE_UNAFFORDABLE')).toHaveLength(8);
    expect(rows('flo_receipts')).toHaveLength(500);
    expect(rows('receipt_lines').filter((r) => r.rejected_qty !== '0')).toHaveLength(40);
    expect(rows('receipt_lines').every((r) => r.accepted_qty !== '0')).toBe(true);
  });

  it('fee refusals (FEE_UNAFFORDABLE) are timely, eligible responses', () => {
    const fee = rows('offers').filter((r) => r.decline_reason_code === 'FEE_UNAFFORDABLE');
    expect(fee).toHaveLength(8);
    for (const o of fee) expect(o).toMatchObject({ state: 'DECLINED', r_eligible: true, r_timely: true, r_exclusion: null });
  });

  it('warehouse, reporting and evidence volumes', () => {
    expect(rows('expected_inbounds')).toHaveLength(80);
    expect(by('expected_inbounds', 'state')).toEqual({ EXPECTED: 5, INSPECTED: 75 });
    expect(rows('inspections')).toHaveLength(75);
    expect(rows('inventory_batches')).toHaveLength(120);
    expect(rows('inspection_lines').filter((r) => r.quarantined_qty !== '0')).toHaveLength(8);
    expect(rows('inspection_lines').filter((r) => r.rejected_qty !== '0')).toHaveLength(6);
    expect(rows('dispositions')).toHaveLength(6);
    expect(by('stock_movements', 'type').QUARANTINE_RELEASE).toBe(5);
    expect(rows('distribution_events')).toHaveLength(120);
    expect(new Set(rows('distribution_events').map((r) => r.receipt_id)).size).toBe(100);
    expect(by('evidence_obligations', 'type')).toEqual({ BAST: 500, DISTRIBUTION: 120, RECEIPT_PHOTO: 504 });
    const st = by('evidence_obligations', 'state');
    expect(st.UNDER_REVIEW).toBeGreaterThanOrEqual(10);
    expect(st.EXCUSED).toBeGreaterThanOrEqual(6);
    expect(st.NEEDS_CLARIFICATION).toBeGreaterThanOrEqual(5);
    expect(st.REJECTED_FINAL).toBeGreaterThanOrEqual(3);
    const tl = by('evidence_obligations', 'resolved_timeliness');
    expect(tl.ON_TIME).toBeGreaterThan(0);
    expect(tl.LATE).toBeGreaterThan(0);
    expect(rows('evidence_submissions').filter((r) => (r.version as number) > 1).length).toBeGreaterThanOrEqual(4);
    expect(rows('tasks').filter((r) => r.kind === 'DISTRIBUTION_STATUS_UNKNOWN')).toHaveLength(6);
    expect(rows('jobs').filter((r) => r.kind === 'DISTRIBUTION_FOLLOWUP').length).toBeGreaterThan(0);
  });

  it('no stored scores anywhere', () => {
    for (const [table, list] of g.ds.tables) {
      for (const r of list.slice(0, 1)) {
        for (const k of Object.keys(r)) expect(`${table}.${k}`).not.toMatch(/(^|_)(score_[a-z]|s_score|r_score|e_score|fairness|responsiveness)/);
      }
    }
    expect([...g.ds.tables.keys()]).not.toContain('allocation_runs');
  });

  it('NEW FLOs have no history (offers, allocations, receipts, obligations)', () => {
    const newIds = new Set(g.flos.filter((f) => f.tenure === 'NEW').map((f) => f.id));
    expect(newIds.size).toBe(20);
    for (const t of ['offers', 'allocations', 'flo_receipts', 'campaign_lines', 'distribution_events'] as const) {
      expect(rows(t).filter((r) => newIds.has(r.flo_id as string))).toHaveLength(0);
    }
    expect(rows('need_assessments').filter((r) => newIds.has(r.flo_id as string))).toHaveLength(0);
  });
});

describe('enforceBySwap', () => {
  it('pins fixtures and preserves the multiset', () => {
    const counts = { A: 5, B: 3, C: 2 } as const;
    const arr = labelMultiset(counts);
    const fixtures = new Set([0, 1]);
    enforceBySwap(arr, [
      { index: 0, label: 'f0', matches: (v) => v === 'C' },
      { index: 1, label: 'f1', matches: (v) => v === 'B' },
    ], fixtures);
    expect(arr[0]).toBe('C');
    expect(arr[1]).toBe('B');
    expect(sameMultiset(arr, counts)).toBe(true);
  });

  it('throws when no donor value exists', () => {
    const arr = labelMultiset({ A: 3 } as const) as string[];
    expect(() => enforceBySwap(arr, [{ index: 0, label: 'x', matches: (v) => v === 'Z' }], new Set([0]))).toThrow(/cannot be met/);
  });
});
