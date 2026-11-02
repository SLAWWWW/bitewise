import { describe, it, expect } from 'vitest';
import {
  addQ,
  cmpQ,
  floorToIncrement,
  formatQty,
  formatQtyLocale,
  isWhole,
  minQ,
  parseDbQty,
  parseQty,
  positiveQtyString,
  qtyString,
  QtyParseError,
  subQ,
  sumQ,
} from '@/src/lib/qty';

describe('parseQty / formatQty', () => {
  it('parses decimal strings into bigint milli-units', () => {
    expect(parseQty('40.5')).toBe(40500n);
    expect(parseQty('40')).toBe(40000n);
    expect(parseQty('0.125')).toBe(125n);
    expect(parseQty('0')).toBe(0n);
  });

  it('rejects floats beyond 3 decimals, exponents, signs and junk', () => {
    for (const bad of ['1.2345', '1e3', '-1', '+1', '1.', '.5', '', ' ', 'abc', '1,5']) {
      expect(() => parseQty(bad), bad).toThrow(QtyParseError);
    }
  });

  it('accepts signed values only when asked', () => {
    expect(parseQty('-2.5', { signed: true })).toBe(-2500n);
  });

  it('round-trips canonically without trailing zeros', () => {
    for (const s of ['40.5', '40', '0.125', '0.1', '12345678901.999']) expect(formatQty(parseQty(s))).toBe(s);
    expect(formatQty(-2500n)).toBe('-2.5');
  });

  it('parses pg numeric strings with trailing zeros', () => {
    expect(parseDbQty('40.500')).toBe(40500n);
    expect(parseDbQty('120.000')).toBe(120000n);
    expect(parseDbQty('-3.250')).toBe(-3250n);
    expect(() => parseDbQty('1.0001')).toThrow(QtyParseError);
  });

  it('never goes through floats (0.1 + 0.2 is exactly 0.3)', () => {
    expect(formatQty(addQ(parseQty('0.1'), parseQty('0.2')))).toBe('0.3');
  });
});

describe('qty arithmetic', () => {
  it('adds, subtracts, compares, mins and sums', () => {
    expect(subQ(parseQty('120'), parseQty('60'))).toBe(60000n);
    expect(cmpQ(1n, 2n)).toBe(-1);
    expect(cmpQ(2n, 2n)).toBe(0);
    expect(cmpQ(3n, 2n)).toBe(1);
    expect(minQ(parseQty('60'), parseQty('40'))).toBe(40000n);
    expect(sumQ([1000n, 2000n, 500n])).toBe(3500n);
  });

  it('floors to the allocation increment', () => {
    expect(floorToIncrement(parseQty('45'), parseQty('10'))).toBe(parseQty('40'));
    expect(floorToIncrement(parseQty('2.75'), parseQty('0.5'))).toBe(parseQty('2.5'));
    expect(floorToIncrement(parseQty('40'), parseQty('10'))).toBe(parseQty('40'));
    expect(floorToIncrement(-1500n, 1000n)).toBe(-2000n);
    expect(() => floorToIncrement(1000n, 0n)).toThrow(RangeError);
  });

  it('detects whole counts', () => {
    expect(isWhole(parseQty('3'))).toBe(true);
    expect(isWhole(parseQty('3.5'))).toBe(false);
  });
});

describe('qty display + schema', () => {
  it('formats with id-ID separators exactly', () => {
    expect(formatQtyLocale(parseQty('1234.5'), 'id-ID')).toBe('1.234,5');
    expect(formatQtyLocale(parseQty('1234.5'), 'en-GB')).toBe('1,234.5');
    expect(formatQtyLocale(parseQty('12345678901.125'), 'id-ID')).toBe('12.345.678.901,125');
  });

  it('validates wire strings with zod', () => {
    expect(qtyString.safeParse('40.5').success).toBe(true);
    expect(qtyString.safeParse('40.5555').success).toBe(false);
    expect(qtyString.safeParse(40.5).success).toBe(false);
    expect(positiveQtyString.safeParse('0').success).toBe(false);
    expect(positiveQtyString.safeParse('0.001').success).toBe(true);
  });
});
