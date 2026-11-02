/**
 * Exact quantities as bigint milli-units (numeric(14,3) in SQL, string on the wire).
 * `parseQty('40.5') === 40500n`. Never use floats for quantities.
 */
import { z } from 'zod';

export type Qty = bigint;

export const QTY_SCALE = 1000n;
export const ZERO: Qty = 0n;

/** Non-negative decimal with up to 3 fraction digits, e.g. "40", "40.5", "0.125". */
export const QTY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;
/** Signed variant for deltas (adjustments). */
export const SIGNED_QTY_PATTERN = /^-?\d{1,11}(\.\d{1,3})?$/;

export const qtyString = z.string().regex(QTY_PATTERN, { message: 'Expected a quantity like "40" or "40.5" (max 3 decimals)' });
export const positiveQtyString = qtyString.refine((s) => parseQty(s) > 0n, { message: 'Quantity must be greater than 0' });
export const signedQtyString = z
  .string()
  .regex(SIGNED_QTY_PATTERN, { message: 'Expected a signed quantity like "-2" or "1.5" (max 3 decimals)' });

export class QtyParseError extends Error {
  constructor(input: unknown) {
    super(`Invalid quantity: ${JSON.stringify(input)}`);
    this.name = 'QtyParseError';
  }
}

/** Parse a decimal string into milli-units. Accepts an optional leading '-' only if `signed`. */
export function parseQty(input: string, opts: { signed?: boolean } = {}): Qty {
  const s = typeof input === 'string' ? input.trim() : input;
  const re = opts.signed ? SIGNED_QTY_PATTERN : QTY_PATTERN;
  if (typeof s !== 'string' || !re.test(s)) throw new QtyParseError(input);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [int, frac = ''] = body.split('.');
  const milli = BigInt(int) * QTY_SCALE + BigInt((frac + '000').slice(0, 3));
  return neg ? -milli : milli;
}

/** Parse a pg numeric string (may have trailing zeros like "40.500"). */
export function parseDbQty(input: string): Qty {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!m) throw new QtyParseError(input);
  const frac = m[3] ?? '';
  if (frac.length > 3 && /[1-9]/.test(frac.slice(3))) throw new QtyParseError(input);
  const milli = BigInt(m[2]) * QTY_SCALE + BigInt((frac + '000').slice(0, 3));
  return m[1] === '-' ? -milli : milli;
}

/** Canonical wire/DB string: no trailing zeros, no exponent. 40500n → "40.5". */
export function formatQty(q: Qty): string {
  const neg = q < 0n;
  const abs = neg ? -q : q;
  const int = abs / QTY_SCALE;
  const frac = (abs % QTY_SCALE).toString().padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int.toString()}${frac ? '.' + frac : ''}`;
}

/**
 * Locale display (id-ID uses '.' grouping and ',' decimals). Exact: no float conversion.
 */
export function formatQtyLocale(q: Qty, locale: string = 'id-ID'): string {
  const neg = q < 0n;
  const abs = neg ? -q : q;
  const int = abs / QTY_SCALE;
  const frac = (abs % QTY_SCALE).toString().padStart(3, '0').replace(/0+$/, '');
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const intStr = new Intl.NumberFormat(locale, { useGrouping: true }).format(int);
  return `${neg ? '-' : ''}${intStr}${frac ? decimal + frac : ''}`;
}

export const addQ = (a: Qty, b: Qty): Qty => a + b;
export const subQ = (a: Qty, b: Qty): Qty => a - b;
export const cmpQ = (a: Qty, b: Qty): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
export const minQ = (a: Qty, b: Qty): Qty => (a < b ? a : b);
export const maxQ = (a: Qty, b: Qty): Qty => (a > b ? a : b);
export const sumQ = (xs: Iterable<Qty>): Qty => {
  let t = 0n;
  for (const x of xs) t += x;
  return t;
};

/** Round down to a multiple of `increment` (> 0). Negative q rounds toward -∞. */
export function floorToIncrement(q: Qty, increment: Qty): Qty {
  if (increment <= 0n) throw new RangeError('increment must be > 0');
  const r = q % increment;
  if (r === 0n) return q;
  return q >= 0n ? q - r : q - r - increment;
}

/** True when q is a whole number of base units (COUNT unit kinds). */
export const isWhole = (q: Qty): boolean => q % QTY_SCALE === 0n;

/** True when q respects the allocation increment. */
export const isMultipleOf = (q: Qty, increment: Qty): boolean => increment > 0n && q % increment === 0n;

/** Ratio as a JS number — only for factor computation, never for balances. */
export function ratio(num: Qty, den: Qty): number {
  if (den === 0n) throw new RangeError('division by zero');
  return Number(num) / Number(den);
}
