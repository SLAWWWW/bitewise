import type { StorageType } from '@/lib/types';

/**
 * Storage zones are DERIVED from data that already exists — an item's
 * `storage_type` says which zone it belongs in, and the branch's `capacity_kg`
 * plus its facility flags say how big each zone is. No extra tables, and the
 * zone view can never disagree with the inventory it's built from.
 */

export interface ZoneDefinition {
  key: StorageType;
  label: string;
  /** Target temperature in °C — what the zone is set to hold. */
  setpoint_c: number;
  /** Acceptable band around the setpoint before it's a problem. */
  tolerance_c: number;
  description: string;
}

export const ZONES: ZoneDefinition[] = [
  {
    key: 'frozen',
    label: 'Frozen',
    setpoint_c: -18,
    tolerance_c: 3,
    description: 'Long-hold frozen goods. Anything above −15°C risks partial thaw.',
  },
  {
    key: 'cold',
    label: 'Chilled',
    setpoint_c: 4,
    tolerance_c: 2,
    description: 'Cooked meals, dairy and cut produce. The critical zone in a tropical climate.',
  },
  {
    key: 'ambient',
    label: 'Ambient',
    setpoint_c: 25,
    tolerance_c: 4,
    description: 'Shelf-stable dry goods, canned items and sealed beverages.',
  },
];

/**
 * How a branch's total capacity is split across zones.
 *
 * A branch without cold storage gets no chilled or frozen allocation at all —
 * which is exactly what makes a chilled item sitting at such a branch a real
 * flag rather than a rounding detail.
 */
export function zoneAllocation(
  capacityKg: number,
  hasColdStorage: boolean
): Record<StorageType, number> {
  if (!hasColdStorage) {
    return { ambient: capacityKg, cold: 0, frozen: 0 };
  }
  return {
    ambient: Math.round(capacityKg * 0.55),
    cold: Math.round(capacityKg * 0.35),
    frozen: Math.round(capacityKg * 0.1),
  };
}

/**
 * Modelled zone temperature — NOT a sensor reading, and labelled as modelled
 * wherever it's shown.
 *
 * Deterministic on purpose: derived only from the setpoint and how full the zone
 * is, so it's identical on the server and the client (no hydration mismatch) and
 * doesn't jitter on every poll. A fuller zone holds less cold air and drifts
 * warm, which is physically the right direction and gives the number a reason to
 * exist beyond decoration.
 */
export function modelledTemperature(zone: ZoneDefinition, occupancyRatio: number): number {
  const clamped = Math.min(1.2, Math.max(0, occupancyRatio));
  // Drift scales with how packed the zone is, up to ~1.5× tolerance when overfull.
  const drift = clamped * clamped * zone.tolerance_c * 1.25;
  return Number((zone.setpoint_c + drift).toFixed(1));
}

export type ZoneHealth = 'nominal' | 'drifting' | 'breach';

export function zoneHealth(zone: ZoneDefinition, temperatureC: number): ZoneHealth {
  const delta = Math.abs(temperatureC - zone.setpoint_c);
  if (delta <= zone.tolerance_c * 0.6) return 'nominal';
  if (delta <= zone.tolerance_c) return 'drifting';
  return 'breach';
}

/** Rack occupancy band, so "is the rack full" has a defined answer. */
export type RackState = 'space' | 'filling' | 'full' | 'over';

export function rackState(usedKg: number, capacityKg: number): RackState {
  if (capacityKg <= 0) return usedKg > 0 ? 'over' : 'space';
  const ratio = usedKg / capacityKg;
  if (ratio >= 1) return 'over';
  if (ratio >= 0.85) return 'full';
  if (ratio >= 0.6) return 'filling';
  return 'space';
}

/** Shared across every place an urgency badge renders (storage, dispatch,
 *  the public food-card list) so the cutoffs are documented once, not
 *  guessed at from a colored badge with no explanation. */
export const URGENCY_TOOLTIP =
  'Critical: under 6h left · Urgent: under 24h · Monitor: under 72h · Stable: 72h or more.';

/** Human shelf-life, chosen so the unit matches the magnitude — hours for
 *  today's problems, weeks for things nobody needs to think about yet. */
export function describeShelfLife(expiryAt: string, now = Date.now()): {
  label: string;
  hours: number;
  tier: 'expired' | 'critical' | 'urgent' | 'monitor' | 'stable';
} {
  const hours = (new Date(expiryAt).getTime() - now) / 3_600_000;

  if (hours <= 0) return { label: 'Expired', hours, tier: 'expired' };

  let label: string;
  if (hours < 1) label = `${Math.round(hours * 60)} min left`;
  else if (hours < 48) label = `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h left`;
  else if (hours < 24 * 14) label = `${Math.round(hours / 24)} days left`;
  else if (hours < 24 * 90) label = `${Math.round(hours / (24 * 7))} weeks left`;
  else label = `${Math.round(hours / (24 * 30))} months left`;

  const tier =
    hours < 6 ? 'critical' : hours < 24 ? 'urgent' : hours < 72 ? 'monitor' : 'stable';

  return { label, hours, tier };
}
