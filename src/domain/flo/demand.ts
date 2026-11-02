/**
 * Category demand over a horizon (PRD §7, architecture C "Horizon").
 *
 * D = Σ over local dates d in [fromDate, toDateExcl) of the event quantity for each service
 * event on d (schedule effective on d, dow(d) ∈ service_dows, d not closed). The event
 * quantity comes from the CONFIRMED category demand row effective on d:
 *   PER_EVENT_QTY  → quantity
 *   PER_PERSON_QTY → people_per_event × quantity (exact bigint milli-units)
 *
 * Unknown is null, never 0:
 *   - any service event without an effective confirmed demand row → DEMAND_MISSING
 *   - any horizon date without an effective schedule → SCHEDULE_GAP
 *   - two count bases effective on the same date → MIXED_COUNT_BASIS (never added)
 *   - demand rows in different units that cannot be made comparable → UNIT_MISMATCH
 * D = 0 is only returned when every date is documented and no event falls in the horizon
 * (flag ZERO_DEMAND). `known_value` keeps the partial sum visible for staff review.
 */
import { DEFAULT_TZ } from '@/src/lib/tz';
import { parseDbQty, type Qty } from '@/src/lib/qty';
import type { DatedWindow } from './hours';
import { resolveScheduleDays, type CountBasis, type ServiceSchedule } from './schedule';

import { DEMAND_BASES, type DemandBasis } from '@/src/shared/enums';
export { DEMAND_BASES, type DemandBasis };

export interface CategoryDemand {
  id: string;
  unit: string;
  basis: DemandBasis;
  /** numeric(14,3) string from the DB, or milli-units. */
  quantity: string | Qty;
  /** Local date, inclusive. */
  valid_from: string;
  /** Local date, exclusive; null = open-ended. */
  valid_to_excl: string | null;
  status: 'PROPOSED' | 'CONFIRMED';
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export type DemandFlag = 'NO_SCHEDULE' | 'SCHEDULE_GAP' | 'DEMAND_MISSING' | 'MIXED_COUNT_BASIS' | 'UNIT_MISMATCH' | 'ZERO_DEMAND';

export interface DemandEventLine {
  date: string;
  schedule_id: string;
  count_basis: CountBasis;
  people: number;
  demand_id: string | null;
  qty: Qty | null;
}

export interface DemandResult {
  /** Comparable demand in `unit`, or null when unknown/incomplete. */
  value: Qty | null;
  /** Sum over events whose quantity is known (partial when `complete` is false). */
  known_value: Qty;
  unit: string | null;
  complete: boolean;
  /** Demand basis used; MIXED when rows with both bases contributed. */
  basis: DemandBasis | 'MIXED' | null;
  /** Count basis of the schedules used; MIXED when several contributed on different dates. */
  count_basis: CountBasis | 'MIXED' | null;
  flags: DemandFlag[];
  sources: { schedule_ids: string[]; demand_ids: string[] };
  events: DemandEventLine[];
  event_count: number;
  dates_missing_schedule: string[];
  dates_missing_demand: string[];
  dates_mixed_basis: string[];
}

export interface DemandInput {
  schedules: readonly ServiceSchedule[];
  demands: readonly CategoryDemand[];
  /** Local date, inclusive. */
  fromDate: string;
  /** Local date, exclusive. */
  toDateExcl: string;
  closures?: readonly DatedWindow[];
  tz?: string;
  /** Target unit. Defaults to the unit of the effective demand rows (must agree). */
  unit?: string;
  /**
   * Converts a quantity from a demand row's unit into `unit`; return null when no approved
   * conversion exists (see src/domain/units/conversion). Without it, units must match.
   */
  toUnit?: (qty: Qty, fromUnit: string) => Qty | null;
}

const toQty = (q: string | Qty): Qty => (typeof q === 'bigint' ? q : parseDbQty(q));

const latestFirst = (a: CategoryDemand, b: CategoryDemand): number =>
  a.valid_from > b.valid_from ? -1 : a.valid_from < b.valid_from ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The CONFIRMED demand row effective on `date` (latest valid_from wins; ties lowest id).
 * PROPOSED rows are never used: demand requires staff confirmation (PRD §5).
 */
export function effectiveDemandOn(demands: readonly CategoryDemand[], date: string): CategoryDemand | null {
  return (
    demands
      .filter(
        (d) => d.status === 'CONFIRMED' && d.valid_from <= date && (d.valid_to_excl == null || date < d.valid_to_excl),
      )
      .sort(latestFirst)[0] ?? null
  );
}

/** Event quantity for one service event from one demand row (exact). */
export function eventQuantity(demand: CategoryDemand, people: number): Qty {
  if (!Number.isInteger(people) || people < 0) throw new RangeError(`Invalid people count: ${people}`);
  const q = toQty(demand.quantity);
  return demand.basis === 'PER_EVENT_QTY' ? q : BigInt(people) * q;
}

const norm = (u: string) => u.trim().toLowerCase();

export function demandOverHorizon(input: DemandInput): DemandResult {
  const tz = input.tz ?? DEFAULT_TZ;
  const days = resolveScheduleDays(input.schedules, input.fromDate, input.toDateExcl, { closures: input.closures, tz });

  const flags = new Set<DemandFlag>();
  const scheduleIds = new Set<string>();
  const demandIds = new Set<string>();
  const usedBases = new Set<DemandBasis>();
  const usedCountBases = new Set<CountBasis>();
  const dates_missing_schedule: string[] = [];
  const dates_missing_demand: string[] = [];
  const dates_mixed_basis: string[] = [];
  const events: DemandEventLine[] = [];
  let unit: string | null = input.unit ?? null;
  let known: Qty = 0n;
  let unknown = false;

  for (const day of days) {
    if (day.schedules.length === 0) {
      dates_missing_schedule.push(day.date);
      unknown = true;
      continue;
    }
    if (day.schedules.length > 1) {
      dates_mixed_basis.push(day.date);
      flags.add('MIXED_COUNT_BASIS');
      unknown = true;
    }
    const demand = day.events.length > 0 ? effectiveDemandOn(input.demands, day.date) : null;
    let missingToday = false;
    for (const ev of day.events) {
      scheduleIds.add(ev.schedule_id);
      usedCountBases.add(ev.count_basis);
      let qty: Qty | null = null;
      if (demand) {
        demandIds.add(demand.id);
        usedBases.add(demand.basis);
        qty = eventQuantity(demand, ev.people);
        if (unit == null) unit = demand.unit;
        if (norm(demand.unit) !== norm(unit)) {
          const converted = input.toUnit ? input.toUnit(qty, demand.unit) : null;
          if (converted == null) {
            flags.add('UNIT_MISMATCH');
            unknown = true;
          }
          qty = converted;
        }
      } else {
        missingToday = true;
        unknown = true;
      }
      if (qty != null) known += qty;
      events.push({
        date: ev.date,
        schedule_id: ev.schedule_id,
        count_basis: ev.count_basis,
        people: ev.people,
        demand_id: demand?.id ?? null,
        qty,
      });
    }
    if (missingToday) {
      dates_missing_demand.push(day.date);
      flags.add('DEMAND_MISSING');
    }
  }

  if (dates_missing_schedule.length > 0) {
    flags.add(dates_missing_schedule.length === days.length ? 'NO_SCHEDULE' : 'SCHEDULE_GAP');
  }
  const complete = !unknown;
  if (complete && events.length === 0) flags.add('ZERO_DEMAND');

  const basis: DemandResult['basis'] = usedBases.size === 0 ? null : usedBases.size === 1 ? [...usedBases][0] : 'MIXED';
  const count_basis: DemandResult['count_basis'] =
    usedCountBases.size === 0 ? null : usedCountBases.size === 1 ? [...usedCountBases][0] : 'MIXED';

  return {
    value: complete ? known : null,
    known_value: known,
    unit,
    complete,
    basis,
    count_basis,
    flags: [...flags].sort(),
    sources: { schedule_ids: [...scheduleIds].sort(), demand_ids: [...demandIds].sort() },
    events,
    event_count: events.length,
    dates_missing_schedule,
    dates_missing_demand,
    dates_mixed_basis,
  };
}
