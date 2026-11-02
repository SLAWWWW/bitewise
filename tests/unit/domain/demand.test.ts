import { describe, expect, it } from 'vitest';
import { demandOverHorizon, effectiveDemandOn, eventQuantity, type CategoryDemand } from '@/src/domain/flo/demand';
import {
  effectiveSchedulesOn,
  localDateRange,
  peopleByBasisOn,
  resolveSchedule,
  serviceEvents,
  type ServiceSchedule,
} from '@/src/domain/flo/schedule';
import { formatQty, parseQty } from '@/src/lib/qty';

const wib = (local: string) => new Date(`${local}+07:00`);

function schedule(p: Partial<ServiceSchedule> & Pick<ServiceSchedule, 'id' | 'effective_from'>): ServiceSchedule {
  return {
    effective_to_excl: null,
    service_dows: [1, 2, 3, 4, 5, 6, 7],
    people_per_event: 10,
    count_basis: 'PER_EVENT',
    ...p,
  };
}

function demand(p: Partial<CategoryDemand> & Pick<CategoryDemand, 'id' | 'valid_from'>): CategoryDemand {
  return {
    unit: 'portion',
    basis: 'PER_PERSON_QTY',
    quantity: '1',
    valid_to_excl: null,
    status: 'CONFIRMED',
    ...p,
  };
}

describe('schedule resolution', () => {
  it('enumerates local dates in a half-open range', () => {
    expect(localDateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(localDateRange('2026-10-30', '2026-10-30')).toEqual([]);
  });

  it('uses the latest effective_from per count basis on each date', () => {
    const old = schedule({ id: 's-old', effective_from: '2026-01-01', people_per_event: 50 });
    const changed = schedule({ id: 's-new', effective_from: '2026-10-15', people_per_event: 80 });
    expect(resolveSchedule([old, changed], '2026-10-14', 'PER_EVENT')?.id).toBe('s-old');
    expect(resolveSchedule([old, changed], '2026-10-15', 'PER_EVENT')?.id).toBe('s-new');
    expect(resolveSchedule([old, changed], '2025-12-31', 'PER_EVENT')).toBeNull();
  });

  it('honours effective_to_excl and service days (ISO dow)', () => {
    const s = schedule({ id: 's', effective_from: '2026-10-26', effective_to_excl: '2026-11-02', service_dows: [1, 3, 5] });
    const events = serviceEvents([s], '2026-10-19', '2026-11-09');
    expect(events.map((e) => e.date)).toEqual(['2026-10-26', '2026-10-28', '2026-10-30']);
  });

  it('keeps count bases separate (never adds DAILY_RESIDENTS to WEEKLY_REACH)', () => {
    const residents = schedule({ id: 'r', effective_from: '2026-01-01', count_basis: 'DAILY_RESIDENTS', people_per_event: 40 });
    const reach = schedule({ id: 'w', effective_from: '2026-01-01', count_basis: 'WEEKLY_REACH', people_per_event: 200, service_dows: [6] });
    expect(effectiveSchedulesOn([reach, residents], '2026-10-26').map((s) => s.id)).toEqual(['r', 'w']);
    const people = peopleByBasisOn([residents, reach], '2026-10-26');
    expect(people).toEqual({
      DAILY_RESIDENTS: { people: 40, schedule_id: 'r', verified: false },
      WEEKLY_REACH: { people: 200, schedule_id: 'w', verified: false },
    });
    expect(Object.values(people).some((p) => p?.people === 240)).toBe(false);
  });

  it('skips fully closed dates', () => {
    const s = schedule({ id: 's', effective_from: '2026-01-01' });
    const closures = [{ starts_at: wib('2026-10-28T00:00:00'), ends_at: wib('2026-10-29T00:00:00') }];
    expect(serviceEvents([s], '2026-10-26', '2026-10-30', { closures }).map((e) => e.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-29',
    ]);
  });
});

describe('category demand', () => {
  it('uses only CONFIRMED rows, latest valid_from first', () => {
    const rows = [
      demand({ id: 'd1', valid_from: '2026-01-01', quantity: '1' }),
      demand({ id: 'd2', valid_from: '2026-10-20', quantity: '2' }),
      demand({ id: 'd3', valid_from: '2026-10-25', quantity: '9', status: 'PROPOSED' }),
    ];
    expect(effectiveDemandOn(rows, '2026-10-19')?.id).toBe('d1');
    expect(effectiveDemandOn(rows, '2026-10-26')?.id).toBe('d2');
  });

  it('PER_EVENT_QTY vs PER_PERSON_QTY event quantities are exact', () => {
    expect(formatQty(eventQuantity(demand({ id: 'e', valid_from: '2026-01-01', basis: 'PER_EVENT_QTY', quantity: '25' }), 80))).toBe('25');
    expect(formatQty(eventQuantity(demand({ id: 'p', valid_from: '2026-01-01', basis: 'PER_PERSON_QTY', quantity: '0.125' }), 80))).toBe('10');
    expect(formatQty(eventQuantity(demand({ id: 'p', valid_from: '2026-01-01', quantity: '0.333' }), 3))).toBe('0.999');
  });
});

describe('demandOverHorizon', () => {
  it('uses the schedule in force on each date when it changes mid-horizon', () => {
    // 2026-10-19 (Mon) .. 2026-11-01 (Sun) exclusive end 2026-11-02: 14 days.
    const before = schedule({ id: 's1', effective_from: '2026-09-01', effective_to_excl: '2026-10-26', service_dows: [1, 3, 5], people_per_event: 50 });
    const after = schedule({ id: 's2', effective_from: '2026-10-26', service_dows: [1, 2, 3, 4, 5, 6, 7], people_per_event: 80 });
    const d = demand({ id: 'd', valid_from: '2026-01-01', basis: 'PER_PERSON_QTY', quantity: '0.5', unit: 'kg' });
    const r = demandOverHorizon({ schedules: [before, after], demands: [d], fromDate: '2026-10-19', toDateExcl: '2026-11-02' });
    // Week 1: Mon/Wed/Fri × 50 × 0.5 = 75 kg. Week 2: 7 × 80 × 0.5 = 280 kg.
    expect(r.complete).toBe(true);
    expect(formatQty(r.value!)).toBe('355');
    expect(r.unit).toBe('kg');
    expect(r.event_count).toBe(10);
    expect(r.sources).toEqual({ schedule_ids: ['s1', 's2'], demand_ids: ['d'] });
    expect(r.basis).toBe('PER_PERSON_QTY');
    expect(r.count_basis).toBe('PER_EVENT');
    // Today's headcount (80) for the whole horizon would give 14 × 40 = 560: must not happen.
    expect(r.value).not.toBe(parseQty('560'));
  });

  it('also follows a demand-row change mid-horizon (PER_EVENT_QTY → PER_PERSON_QTY)', () => {
    const s = schedule({ id: 's', effective_from: '2026-01-01', people_per_event: 20, service_dows: [1] });
    const rows = [
      demand({ id: 'a', valid_from: '2026-01-01', valid_to_excl: '2026-10-26', basis: 'PER_EVENT_QTY', quantity: '15' }),
      demand({ id: 'b', valid_from: '2026-10-26', basis: 'PER_PERSON_QTY', quantity: '1' }),
    ];
    const r = demandOverHorizon({ schedules: [s], demands: rows, fromDate: '2026-10-12', toDateExcl: '2026-11-03' });
    // Mondays 10-12, 10-19 → 15 each; 10-26, 11-02 → 20 each.
    expect(formatQty(r.value!)).toBe('70');
    expect(r.basis).toBe('MIXED');
  });

  it('missing demand is null, never 0 (AC09), with the partial sum kept visible', () => {
    const s = schedule({ id: 's', effective_from: '2026-01-01', people_per_event: 10 });
    const d = demand({ id: 'd', valid_from: '2026-10-25', quantity: '1' });
    const r = demandOverHorizon({ schedules: [s], demands: [d], fromDate: '2026-10-20', toDateExcl: '2026-10-27' });
    expect(r.value).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.flags).toContain('DEMAND_MISSING');
    expect(r.dates_missing_demand).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    expect(formatQty(r.known_value)).toBe('20');
  });

  it('no demand rows at all and only PROPOSED rows are unknown', () => {
    const s = schedule({ id: 's', effective_from: '2026-01-01' });
    const none = demandOverHorizon({ schedules: [s], demands: [], fromDate: '2026-10-20', toDateExcl: '2026-10-27' });
    expect(none.value).toBeNull();
    const proposed = demandOverHorizon({
      schedules: [s],
      demands: [demand({ id: 'p', valid_from: '2026-01-01', status: 'PROPOSED' })],
      fromDate: '2026-10-20',
      toDateExcl: '2026-10-27',
    });
    expect(proposed.value).toBeNull();
  });

  it('no schedule or a schedule gap is unknown, not zero', () => {
    const d = demand({ id: 'd', valid_from: '2026-01-01' });
    const none = demandOverHorizon({ schedules: [], demands: [d], fromDate: '2026-10-20', toDateExcl: '2026-10-27' });
    expect(none.value).toBeNull();
    expect(none.flags).toEqual(['NO_SCHEDULE']);
    const late = schedule({ id: 's', effective_from: '2026-10-24' });
    const gap = demandOverHorizon({ schedules: [late], demands: [d], fromDate: '2026-10-20', toDateExcl: '2026-10-27' });
    expect(gap.value).toBeNull();
    expect(gap.flags).toEqual(['SCHEDULE_GAP']);
    expect(gap.dates_missing_schedule).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  });

  it('documented schedule without events in the horizon is a real zero', () => {
    const sundays = schedule({ id: 's', effective_from: '2026-01-01', service_dows: [7] });
    const r = demandOverHorizon({
      schedules: [sundays],
      demands: [demand({ id: 'd', valid_from: '2026-01-01' })],
      fromDate: '2026-10-26',
      toDateExcl: '2026-10-31',
    });
    expect(r.value).toBe(0n);
    expect(r.complete).toBe(true);
    expect(r.flags).toEqual(['ZERO_DEMAND']);
  });

  it('two count bases on the same date are not summed (MIXED_COUNT_BASIS → null)', () => {
    const residents = schedule({ id: 'r', effective_from: '2026-01-01', count_basis: 'DAILY_RESIDENTS', people_per_event: 40 });
    const reach = schedule({ id: 'w', effective_from: '2026-01-01', count_basis: 'WEEKLY_REACH', people_per_event: 200, service_dows: [6] });
    const r = demandOverHorizon({
      schedules: [residents, reach],
      demands: [demand({ id: 'd', valid_from: '2026-01-01' })],
      fromDate: '2026-10-26',
      toDateExcl: '2026-11-02',
    });
    expect(r.value).toBeNull();
    expect(r.flags).toContain('MIXED_COUNT_BASIS');
    expect(r.count_basis).toBe('MIXED');
  });

  it('skips closed days', () => {
    const s = schedule({ id: 's', effective_from: '2026-01-01', people_per_event: 10 });
    const closures = [{ starts_at: wib('2026-10-27T00:00:00'), ends_at: wib('2026-10-29T00:00:00') }];
    const r = demandOverHorizon({
      schedules: [s],
      demands: [demand({ id: 'd', valid_from: '2026-01-01' })],
      fromDate: '2026-10-26',
      toDateExcl: '2026-10-30',
      closures,
    });
    expect(formatQty(r.value!)).toBe('20');
  });

  it('unit mismatch without an approved conversion is unknown; with one it converts', () => {
    const s = schedule({ id: 's', effective_from: '2026-01-01', service_dows: [1], people_per_event: 10 });
    const rows = [demand({ id: 'd', valid_from: '2026-01-01', unit: 'pack', basis: 'PER_EVENT_QTY', quantity: '2' })];
    const base = { schedules: [s], demands: rows, fromDate: '2026-10-26', toDateExcl: '2026-10-27', unit: 'portion' };
    const missing = demandOverHorizon(base);
    expect(missing.value).toBeNull();
    expect(missing.flags).toEqual(['UNIT_MISMATCH']);
    const converted = demandOverHorizon({ ...base, toUnit: (q, u) => (u === 'pack' ? q * 6n : null) });
    expect(formatQty(converted.value!)).toBe('12');
  });
});
