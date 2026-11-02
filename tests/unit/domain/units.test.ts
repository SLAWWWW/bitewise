import { describe, expect, it } from 'vitest';
import {
  applyFactor,
  canConvert,
  convert,
  normalizeUnit,
  parseFactor,
  sumComparable,
  type UnitConversion,
} from '@/src/domain/units/conversion';
import {
  allocateWithinCaps,
  effectiveIncrement,
  floorToAllowed,
  isWholeCount,
  validateIncrement,
} from '@/src/domain/units/increments';
import { formatQty, parseQty } from '@/src/lib/qty';

const q = parseQty;
const f = formatQty;

// Seed reference conversions (architecture B.1).
const ROTI_MANIS = 'prod-roti-manis';
const BERAS_5KG = 'prod-beras-5kg';
const WAFER = 'prod-wafer';
const CONVERSIONS: UnitConversion[] = [
  { id: 'c-roti', product_id: ROTI_MANIS, from_unit: 'pack', to_unit: 'portion', factor: '6.000000', provenance: 'APPROVED_ESTIMATE', version: 1, source: 'demo' },
  { id: 'c-beras', product_id: BERAS_5KG, from_unit: 'pack', to_unit: 'kg', factor: '5.000000', provenance: 'MEASURED', version: 1 },
  { id: 'c-wafer', product_id: WAFER, from_unit: 'carton', to_unit: 'pack', factor: '24.000000', provenance: 'MEASURED', version: 1 },
];

describe('convert', () => {
  it('identity needs no conversion row', () => {
    const r = convert(q('12.5'), 'kg', ' KG ', []);
    expect(r).toMatchObject({ missing: false, provenance: 'IDENTITY', direction: 'IDENTITY' });
    expect(!r.missing && f(r.qty)).toBe('12.5');
  });

  it('applies a SKU-specific forward conversion with provenance', () => {
    const r = convert(q('3'), 'pack', 'portion', CONVERSIONS, { productId: ROTI_MANIS });
    expect(r).toMatchObject({ missing: false, provenance: 'APPROVED_ESTIMATE', conversion_id: 'c-roti', estimated: true, rounded: false });
    expect(!r.missing && f(r.qty)).toBe('18');
    const kg = convert(q('4'), 'pack', 'kg', CONVERSIONS, { productId: BERAS_5KG });
    expect(kg).toMatchObject({ missing: false, provenance: 'MEASURED', estimated: false });
    expect(!kg.missing && f(kg.qty)).toBe('20');
  });

  it('applies the inverse of a stored row, flagging rounding', () => {
    const r = convert(q('10'), 'portion', 'pack', CONVERSIONS, { productId: ROTI_MANIS });
    expect(r).toMatchObject({ missing: false, direction: 'INVERSE', rounded: true });
    expect(!r.missing && f(r.qty)).toBe('1.667');
    expect(convert(q('10'), 'portion', 'pack', CONVERSIONS, { productId: ROTI_MANIS, allowInverse: false }).missing).toBe(true);
  });

  it('AC48: unknown unit or mismatched SKU → missing, never invented', () => {
    // "tray" has no conversion at all.
    expect(convert(q('5'), 'tray', 'portion', CONVERSIONS, { productId: ROTI_MANIS })).toEqual({
      missing: true,
      reason: 'NO_CONVERSION',
      from_unit: 'tray',
      to_unit: 'portion',
    });
    // A pack→portion factor from another SKU is not borrowed.
    expect(convert(q('1'), 'pack', 'portion', CONVERSIONS, { productId: BERAS_5KG }).missing).toBe(true);
    // No universal meals-per-kg constant.
    expect(convert(q('1'), 'kg', 'portion', CONVERSIONS).missing).toBe(true);
    // No multi-hop chains (carton→pack→portion).
    expect(convert(q('1'), 'carton', 'portion', CONVERSIONS).missing).toBe(true);
    expect(canConvert('tray', 'portion', CONVERSIONS)).toBe(false);
    expect(canConvert('pack', 'portion', CONVERSIONS, { productId: ROTI_MANIS })).toBe(true);
  });

  it('definitional metric pairs are allowed', () => {
    const r = convert(q('1.25'), 'kg', 'g', []);
    expect(r).toMatchObject({ missing: false, provenance: 'STANDARD' });
    expect(!r.missing && f(r.qty)).toBe('1250');
    const l = convert(q('750'), 'ml', 'l', []);
    expect(!l.missing && f(l.qty)).toBe('0.75');
  });

  it('highest version wins; conflicting factors across SKUs are ambiguous', () => {
    const versions: UnitConversion[] = [
      { id: 'v1', product_id: 'p', from_unit: 'box', to_unit: 'pcs', factor: '10', provenance: 'MEASURED', version: 1 },
      { id: 'v2', product_id: 'p', from_unit: 'box', to_unit: 'pcs', factor: '12', provenance: 'MEASURED', version: 2 },
    ];
    const r = convert(q('2'), 'box', 'pcs', versions, { productId: 'p' });
    expect(!r.missing && [f(r.qty), r.version]).toEqual(['24', 2]);
    const crossSku: UnitConversion[] = [
      { id: 'a', product_id: 'p1', from_unit: 'box', to_unit: 'pcs', factor: '10', provenance: 'MEASURED', version: 1 },
      { id: 'b', product_id: 'p2', from_unit: 'box', to_unit: 'pcs', factor: '12', provenance: 'MEASURED', version: 1 },
    ];
    expect(convert(q('1'), 'box', 'pcs', crossSku)).toMatchObject({ missing: true, reason: 'AMBIGUOUS' });
  });

  it('respects validity windows when an instant is given', () => {
    const rows: UnitConversion[] = [
      { id: 'w', product_id: 'p', from_unit: 'box', to_unit: 'pcs', factor: '10', provenance: 'MEASURED', version: 1, valid_from: '2026-10-01T00:00:00Z', valid_to: '2026-11-01T00:00:00Z' },
    ];
    expect(convert(q('1'), 'box', 'pcs', rows, { at: '2026-10-26T01:00:00Z' }).missing).toBe(false);
    expect(convert(q('1'), 'box', 'pcs', rows, { at: '2026-11-01T00:00:00Z' }).missing).toBe(true);
  });

  it('exact bigint arithmetic with numeric(18,6) factors', () => {
    expect(parseFactor('6.000000')).toBe(6_000_000n);
    expect(parseFactor('0.125')).toBe(125_000n);
    expect(() => parseFactor('0')).toThrow(RangeError);
    expect(() => parseFactor('1.0000001')).toThrow(RangeError);
    expect(f(applyFactor(q('0.001'), parseFactor('0.5')).qty)).toBe('0.001'); // 0.0005 → half-up
    expect(applyFactor(q('0.001'), parseFactor('0.5')).rounded).toBe(true);
    expect(f(applyFactor(q('3.333'), parseFactor('3')).qty)).toBe('9.999');
    expect(normalizeUnit(' Portion ')).toBe('portion');
  });
});

describe('sumComparable (fairness)', () => {
  it('converts what it can and excludes the rest with a completeness flag', () => {
    const r = sumComparable(
      [
        { key: 'l1', qty: q('20'), unit: 'portion' },
        { key: 'l2', qty: q('2'), unit: 'pack', product_id: ROTI_MANIS },
        { key: 'l3', qty: q('3'), unit: 'tray', product_id: ROTI_MANIS },
      ],
      'portion',
      CONVERSIONS,
    );
    expect(f(r.total)).toBe('32');
    expect(r.complete).toBe(false);
    expect(r.excluded).toEqual([{ key: 'l3', unit: 'tray', reason: 'NO_CONVERSION' }]);
    expect(r.estimated).toBe(true);
    expect(r.conversion_ids).toEqual(['c-roti']);
  });

  it('is complete when every line converts', () => {
    const r = sumComparable([{ key: 1, qty: q('5'), unit: 'kg' }], 'kg', CONVERSIONS);
    expect(r).toMatchObject({ complete: true, estimated: false, excluded: [] });
  });
});

describe('increments', () => {
  const COUNT = { unit_kind: 'COUNT' as const, min_increment: '1.000' };
  const MASS = { unit_kind: 'MASS' as const, min_increment: '0.500' };

  it('COUNT units take whole numbers only', () => {
    expect(isWholeCount(q('40'))).toBe(true);
    expect(isWholeCount(q('40.5'))).toBe(false);
    expect(validateIncrement(q('40'), COUNT)).toEqual({ ok: true, increment: 1000n });
    expect(validateIncrement(q('40.5'), COUNT)).toEqual({
      ok: false,
      code: 'NOT_WHOLE_COUNT',
      increment: 1000n,
      nearest_down: q('40'),
      nearest_up: q('41'),
    });
  });

  it('respects min_increment for COUNT packs and MASS', () => {
    const sixPack = { unit_kind: 'COUNT' as const, min_increment: '6' };
    expect(validateIncrement(q('12'), sixPack).ok).toBe(true);
    expect(validateIncrement(q('13'), sixPack)).toMatchObject({ ok: false, code: 'NOT_MULTIPLE_OF_INCREMENT', nearest_down: q('12'), nearest_up: q('18') });
    expect(validateIncrement(q('2.5'), MASS).ok).toBe(true);
    expect(validateIncrement(q('2.25'), MASS)).toMatchObject({ ok: false, code: 'NOT_MULTIPLE_OF_INCREMENT' });
    expect(validateIncrement(0n, MASS)).toMatchObject({ ok: false, code: 'NON_POSITIVE' });
  });

  it('defaults to one base unit and rejects fractional COUNT increments', () => {
    expect(effectiveIncrement({ unit_kind: 'MASS' })).toBe(1000n);
    expect(() => effectiveIncrement({ unit_kind: 'COUNT', min_increment: '0.5' })).toThrow(RangeError);
    expect(() => effectiveIncrement({ unit_kind: 'MASS', min_increment: '0' })).toThrow(RangeError);
  });

  it('keeps the unallocatable remainder visible', () => {
    expect(floorToAllowed(q('125'), { unit_kind: 'COUNT', min_increment: '6' })).toEqual({
      allocatable: q('120'),
      remainder: q('5'),
      increment: q('6'),
    });
    const r = floorToAllowed(q('7.3'), MASS);
    expect([f(r.allocatable), f(r.remainder)]).toEqual(['7', '0.3']);
  });

  it('allocates within caps, skipping unknown capacity, without rounding up', () => {
    // Worked example shape: 120 portions, B capacity 60, unknown capacity, C capacity 100.
    const r = allocateWithinCaps(q('120'), [q('60'), null, q('100')], COUNT);
    expect(r.parts.map(f)).toEqual(['60', '0', '60']);
    expect(f(r.remainder)).toBe('0');
    const packs = allocateWithinCaps(q('20'), [q('7'), q('7')], { unit_kind: 'COUNT', min_increment: '3' });
    expect(packs.parts.map(f)).toEqual(['6', '6']);
    expect(f(packs.remainder)).toBe('8');
  });
});
