/**
 * Allocation increments and whole-count rules (PRD §7, architecture A.0).
 *
 * - COUNT unit kinds take whole base units only (DB: CHECK unit_kind <> 'COUNT' OR q = trunc(q)).
 * - Every allocated quantity must be a multiple of the product's min_increment.
 * - MASS / VOLUME may use up to 3 decimals (milli-unit resolution of src/lib/qty).
 * - Never round a remainder into an impossible shipment: floorToAllowed keeps the
 *   unallocatable remainder visible.
 */
import { QTY_SCALE, floorToIncrement, formatQty, parseDbQty, type Qty } from '@/src/lib/qty';
import type { UnitKind } from '@/src/shared/enums';

export interface IncrementRule {
  unit_kind: UnitKind;
  /** numeric(14,3) string or milli-units; defaults to 1 base unit. */
  min_increment?: string | Qty | null;
}

export type IncrementViolation = 'NON_POSITIVE' | 'NOT_WHOLE_COUNT' | 'NOT_MULTIPLE_OF_INCREMENT';

export type IncrementCheck =
  | { ok: true; increment: Qty }
  | {
      ok: false;
      code: IncrementViolation;
      increment: Qty;
      /** Nearest allowed quantities (down may be 0n). */
      nearest_down: Qty;
      nearest_up: Qty;
    };

/**
 * Effective step in milli-units (default 1 base unit). A COUNT product with a fractional
 * min_increment is a data error (the DB CHECK forbids it) and throws.
 */
export function effectiveIncrement(rule: IncrementRule): Qty {
  const raw = rule.min_increment == null ? QTY_SCALE : typeof rule.min_increment === 'bigint' ? rule.min_increment : parseDbQty(rule.min_increment);
  if (raw <= 0n) throw new RangeError('min_increment must be > 0');
  if (rule.unit_kind === 'COUNT' && raw % QTY_SCALE !== 0n) {
    throw new RangeError(`COUNT product has a fractional min_increment: ${formatQty(raw)}`);
  }
  return raw;
}

/** Whole number of base units. */
export function isWholeCount(q: Qty): boolean {
  return q % QTY_SCALE === 0n;
}

/** Validate a proposed (positive) quantity against the unit kind and increment. */
export function validateIncrement(q: Qty, rule: IncrementRule): IncrementCheck {
  const increment = effectiveIncrement(rule);
  const down = floorToIncrement(q, increment);
  const up = down === q ? q : down + increment;
  if (q <= 0n) return { ok: false, code: 'NON_POSITIVE', increment, nearest_down: 0n, nearest_up: increment };
  if (rule.unit_kind === 'COUNT' && !isWholeCount(q)) {
    return { ok: false, code: 'NOT_WHOLE_COUNT', increment, nearest_down: down, nearest_up: up };
  }
  if (q % increment !== 0n) {
    return { ok: false, code: 'NOT_MULTIPLE_OF_INCREMENT', increment, nearest_down: down, nearest_up: up };
  }
  return { ok: true, increment };
}

/**
 * Largest allowed quantity <= q, plus the remainder that cannot be allocated in one
 * increment-respecting line. remainder = q − allocatable (never hidden).
 */
export function floorToAllowed(q: Qty, rule: IncrementRule): { allocatable: Qty; remainder: Qty; increment: Qty } {
  if (q < 0n) throw new RangeError('quantity must be >= 0');
  const increment = effectiveIncrement(rule);
  const allocatable = floorToIncrement(q, increment);
  return { allocatable, remainder: q - allocatable, increment };
}

/**
 * Split `available` into allowed parts no larger than each cap (in order), leaving the rest
 * as an explicit remainder. Caps of null mean "unknown" and take nothing (unknown capacity
 * requires confirmation before reservation).
 */
export function allocateWithinCaps(
  available: Qty,
  caps: readonly (Qty | null)[],
  rule: IncrementRule,
): { parts: Qty[]; remainder: Qty } {
  if (available < 0n) throw new RangeError('available must be >= 0');
  const increment = effectiveIncrement(rule);
  let remaining = available;
  const parts = caps.map((cap) => {
    if (cap == null || cap <= 0n || remaining <= 0n) return 0n;
    const q = floorToIncrement(cap < remaining ? cap : remaining, increment);
    remaining -= q;
    return q;
  });
  return { parts, remainder: remaining };
}
