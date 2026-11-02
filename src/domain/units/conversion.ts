/**
 * Unit conversion (PRD §7, AC48). Never invent a conversion:
 *   - SKU- and version-specific rows from lumbung.unit_conversions (factor numeric(18,6),
 *     provenance MEASURED | ESTIMATED | APPROVED_ESTIMATE)
 *   - the definitional metric pairs kg↔g and l↔ml (provenance STANDARD)
 *   - identity (same unit)
 * Anything else returns { missing: true } — e.g. 'tray' with no row, or a kg→portion pair
 * without an approved estimate. No universal "meals per kg" constant, no multi-hop chains.
 *
 * Arithmetic is exact on bigint: qty in milli-units (src/lib/qty) × factor in micro-units.
 * A result that is not a whole number of milli-units is rounded half-up and flagged.
 */
import type { Instant } from '@/src/lib/tz';
import type { Qty } from '@/src/lib/qty';

export const FACTOR_SCALE = 1_000_000n;

export type ConversionProvenance = 'MEASURED' | 'ESTIMATED' | 'APPROVED_ESTIMATE';
export type ResultProvenance = ConversionProvenance | 'STANDARD' | 'IDENTITY';

export interface UnitConversion {
  id: string;
  product_id?: string | null;
  from_unit: string;
  to_unit: string;
  /** numeric(18,6) string as returned by pg, e.g. "6.000000". */
  factor: string;
  provenance: ConversionProvenance;
  version: number;
  source?: string | null;
  valid_from?: Instant | null;
  valid_to?: Instant | null;
}

export type ConvertOk = {
  missing: false;
  qty: Qty;
  provenance: ResultProvenance;
  conversion_id: string | null;
  version: number | null;
  /** FORWARD uses the row as stored; INVERSE divides by its factor. */
  direction: 'IDENTITY' | 'FORWARD' | 'INVERSE';
  /** True when the exact result had more than 3 decimals and was rounded half-up. */
  rounded: boolean;
  /** True for ESTIMATED / APPROVED_ESTIMATE provenance. */
  estimated: boolean;
};

export type ConvertMissing = {
  missing: true;
  reason: 'NO_CONVERSION' | 'AMBIGUOUS' | 'INVALID_UNIT';
  from_unit: string;
  to_unit: string;
};

export type ConvertResult = ConvertOk | ConvertMissing;

export interface ConvertOptions {
  /** Restrict to this product's conversions (they are SKU-specific). */
  productId?: string;
  /** Only rows valid at this instant (valid_from <= at < valid_to; nulls open). */
  at?: Instant;
  /** Allow using a row in reverse (to → from). Default true. */
  allowInverse?: boolean;
}

/** Canonical unit key: trimmed, lower-case. */
export function normalizeUnit(u: string): string {
  return u.trim().toLowerCase();
}

const STANDARD: Record<string, Record<string, bigint>> = {
  kg: { g: 1000n * FACTOR_SCALE },
  g: { kg: FACTOR_SCALE / 1000n },
  l: { ml: 1000n * FACTOR_SCALE },
  ml: { l: FACTOR_SCALE / 1000n },
};

/** Parse a numeric(18,6) factor string into micro-units. Throws on non-positive/invalid. */
export function parseFactor(s: string): bigint {
  const m = /^(\d{1,12})(?:\.(\d{1,6})\d*)?$/.exec(String(s).trim());
  if (!m) throw new RangeError(`Invalid conversion factor: ${s}`);
  const tail = String(s).trim().split('.')[1] ?? '';
  if (tail.length > 6 && /[1-9]/.test(tail.slice(6))) throw new RangeError(`Factor has more than 6 decimals: ${s}`);
  const v = BigInt(m[1]) * FACTOR_SCALE + BigInt(((m[2] ?? '') + '000000').slice(0, 6));
  if (v <= 0n) throw new RangeError(`Conversion factor must be > 0: ${s}`);
  return v;
}

/** num/den rounded half-up for non-negative num; sign-symmetric for negatives. */
function divRound(num: bigint, den: bigint): { q: bigint; rounded: boolean } {
  const neg = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = n / d;
  const r = n % d;
  const out = r * 2n >= d ? q + 1n : q;
  return { q: neg ? -out : out, rounded: r !== 0n };
}

/** Multiply milli-unit qty by a micro-unit factor. */
export function applyFactor(qty: Qty, factorMicro: bigint): { qty: Qty; rounded: boolean } {
  const { q, rounded } = divRound(qty * factorMicro, FACTOR_SCALE);
  return { qty: q, rounded };
}

/** Divide milli-unit qty by a micro-unit factor. */
export function applyInverseFactor(qty: Qty, factorMicro: bigint): { qty: Qty; rounded: boolean } {
  const { q, rounded } = divRound(qty * FACTOR_SCALE, factorMicro);
  return { qty: q, rounded };
}

function ms(i: Instant): number {
  return (i instanceof Date ? i : new Date(i)).getTime();
}

function validAt(c: UnitConversion, at: Instant | undefined): boolean {
  if (at === undefined) return true;
  const t = ms(at);
  if (c.valid_from != null && t < ms(c.valid_from)) return false;
  if (c.valid_to != null && t >= ms(c.valid_to)) return false;
  return true;
}

/** Highest version wins; a different factor at the same top version (across SKUs) is ambiguous. */
function pick(rows: UnitConversion[]): UnitConversion | 'AMBIGUOUS' | null {
  if (rows.length === 0) return null;
  const top = Math.max(...rows.map((r) => r.version));
  const best = rows.filter((r) => r.version === top).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const f0 = parseFactor(best[0].factor);
  if (best.some((r) => parseFactor(r.factor) !== f0 || r.provenance !== best[0].provenance)) return 'AMBIGUOUS';
  return best[0];
}

/**
 * convert(qty, from, to, conversions) → exact converted qty with provenance, or
 * { missing: true } when no approved conversion applies. Never guesses.
 */
export function convert(
  qty: Qty,
  fromUnit: string,
  toUnit: string,
  conversions: readonly UnitConversion[],
  opts: ConvertOptions = {},
): ConvertResult {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to) return { missing: true, reason: 'INVALID_UNIT', from_unit: fromUnit, to_unit: toUnit };
  if (from === to) {
    return { missing: false, qty, provenance: 'IDENTITY', conversion_id: null, version: null, direction: 'IDENTITY', rounded: false, estimated: false };
  }

  const candidates = conversions.filter(
    (c) => (opts.productId === undefined || c.product_id === opts.productId) && validAt(c, opts.at),
  );
  const forward = pick(candidates.filter((c) => normalizeUnit(c.from_unit) === from && normalizeUnit(c.to_unit) === to));
  if (forward === 'AMBIGUOUS') return { missing: true, reason: 'AMBIGUOUS', from_unit: fromUnit, to_unit: toUnit };
  if (forward) {
    const r = applyFactor(qty, parseFactor(forward.factor));
    return {
      missing: false,
      qty: r.qty,
      provenance: forward.provenance,
      conversion_id: forward.id,
      version: forward.version,
      direction: 'FORWARD',
      rounded: r.rounded,
      estimated: forward.provenance !== 'MEASURED',
    };
  }
  if (opts.allowInverse !== false) {
    const inverse = pick(candidates.filter((c) => normalizeUnit(c.from_unit) === to && normalizeUnit(c.to_unit) === from));
    if (inverse === 'AMBIGUOUS') return { missing: true, reason: 'AMBIGUOUS', from_unit: fromUnit, to_unit: toUnit };
    if (inverse) {
      const r = applyInverseFactor(qty, parseFactor(inverse.factor));
      return {
        missing: false,
        qty: r.qty,
        provenance: inverse.provenance,
        conversion_id: inverse.id,
        version: inverse.version,
        direction: 'INVERSE',
        rounded: r.rounded,
        estimated: inverse.provenance !== 'MEASURED',
      };
    }
  }
  const std = STANDARD[from]?.[to];
  if (std !== undefined) {
    const r = applyFactor(qty, std);
    return { missing: false, qty: r.qty, provenance: 'STANDARD', conversion_id: null, version: null, direction: 'FORWARD', rounded: r.rounded, estimated: false };
  }
  return { missing: true, reason: 'NO_CONVERSION', from_unit: fromUnit, to_unit: toUnit };
}

/** True when convert() would succeed. */
export function canConvert(
  fromUnit: string,
  toUnit: string,
  conversions: readonly UnitConversion[],
  opts: ConvertOptions = {},
): boolean {
  return !convert(1000n, fromUnit, toUnit, conversions, opts).missing;
}

// ---------------------------------------------------------------------------
// Comparable-unit aggregation (fairness coverage)
// ---------------------------------------------------------------------------

export interface ComparableLine<K = string> {
  key: K;
  qty: Qty;
  unit: string;
  /** The line's product (conversions are SKU-specific). */
  product_id?: string;
  at?: Instant;
}

export interface ComparableSum<K = string> {
  /** Sum of the convertible lines in the comparable unit. */
  total: Qty;
  unit: string;
  /** False when at least one line could not be converted (it is excluded, not guessed). */
  complete: boolean;
  /** Lines excluded for lack of an approved conversion. */
  excluded: { key: K; unit: string; reason: ConvertMissing['reason'] }[];
  /** True when any included line used an ESTIMATED / APPROVED_ESTIMATE factor. */
  estimated: boolean;
  rounded: boolean;
  conversion_ids: string[];
}

/**
 * Convert each line into the comparable unit and sum. Missing conversions exclude the line
 * and clear `complete` (PRD §7: excluded from comparable ratios with a completeness flag).
 */
export function sumComparable<K>(
  lines: readonly ComparableLine<K>[],
  comparableUnit: string,
  conversions: readonly UnitConversion[],
): ComparableSum<K> {
  let total: Qty = 0n;
  let estimated = false;
  let rounded = false;
  const excluded: ComparableSum<K>['excluded'] = [];
  const ids = new Set<string>();
  for (const l of lines) {
    const r = convert(l.qty, l.unit, comparableUnit, conversions, { productId: l.product_id, at: l.at });
    if (r.missing) {
      excluded.push({ key: l.key, unit: l.unit, reason: r.reason });
      continue;
    }
    total += r.qty;
    estimated ||= r.estimated;
    rounded ||= r.rounded;
    if (r.conversion_id) ids.add(r.conversion_id);
  }
  return { total, unit: comparableUnit, complete: excluded.length === 0, excluded, estimated, rounded, conversion_ids: [...ids].sort() };
}
