import { haversine } from '@/lib/utils/geo';

export type VehicleType = 'refrigerated' | 'truck' | 'van' | 'bike';
export type RunStatus = 'assigned' | 'en_route' | 'picked_up' | 'completed' | 'cancelled';
/** The subset of run states that occupy a vehicle. */
export type OpenRunStatus = Extract<RunStatus, 'assigned' | 'en_route' | 'picked_up'>;
/** What the board shows for a vehicle right now. Derived, never stored. */
export type VehicleStatus = OpenRunStatus | 'idle' | 'offline';

export interface VehicleRow {
  id: string;
  branch_id: string;
  label: string;
  type: VehicleType;
  driver_name: string;
  capacity_kg: number;
  is_offline: boolean;
}

export interface FleetRunRow {
  id: string;
  vehicle_id: string;
  listing_id: string | null;
  serving_branch_id: string;
  status: RunStatus;
  quantity_kg: number | null;
  assigned_at: string | null;
  en_route_at: string | null;
  picked_up_at: string | null;
  completed_at: string | null;
}

export const OPEN_RUN_STATUSES: OpenRunStatus[] = ['assigned', 'en_route', 'picked_up'];

/** The next status a staff member can move a run to, in order. */
export const RUN_ADVANCE: Record<string, RunStatus | null> = {
  assigned: 'en_route',
  en_route: 'picked_up',
  picked_up: 'completed',
  completed: null,
  cancelled: null,
};

/** Type predicate, so callers narrowing on this also narrow the status type —
 *  which is what lets vehicleStatus() return a VehicleStatus without a cast. */
export function isOpenRun(status: RunStatus): status is OpenRunStatus {
  return (OPEN_RUN_STATUSES as RunStatus[]).includes(status);
}

/**
 * A vehicle's live status is derived from its open run, never stored alongside
 * it. Storing both invites drift where the board says "idle" while an open run
 * still points at the vehicle.
 */
export function vehicleStatus(vehicle: VehicleRow, openRun: FleetRunRow | undefined): VehicleStatus {
  if (vehicle.is_offline) return 'offline';
  if (openRun && isOpenRun(openRun.status)) return openRun.status;
  return 'idle';
}

/** Chilled/frozen loads need a refrigerated vehicle; everything else can ride
 *  in anything with enough capacity. A bike can't take a 40kg pallet. */
export function vehicleCanCarry(
  vehicle: VehicleRow,
  quantityKg: number,
  needsColdChain: boolean
): boolean {
  if (vehicle.capacity_kg < quantityKg) return false;
  if (needsColdChain && vehicle.type !== 'refrigerated') return false;
  return true;
}

export interface BranchLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface DispatchCandidate {
  vehicle: VehicleRow;
  /** Distance from the vehicle's home branch to the branch needing it. */
  distance_km: number;
  /** True when this vehicle belongs to a different branch than the one served. */
  is_cross_branch: boolean;
  home_branch_name: string;
}

/**
 * Finds vehicles that could take a pickup for `servingBranchId`, best first.
 *
 * Own-branch vehicles always outrank borrowed ones, because borrowing costs a
 * branch its own coverage. Within each group, closest wins. Returning the whole
 * ranked list (rather than just a winner) is what lets the UI say "no van free
 * here — Yishun's is 12km away, borrow it?" instead of silently failing.
 */
export function rankDispatchCandidates(params: {
  vehicles: VehicleRow[];
  openRuns: FleetRunRow[];
  branches: BranchLocation[];
  servingBranchId: string;
  quantityKg: number;
  needsColdChain: boolean;
}): DispatchCandidate[] {
  const { vehicles, openRuns, branches, servingBranchId, quantityKg, needsColdChain } = params;

  const busy = new Set(openRuns.filter((r) => isOpenRun(r.status)).map((r) => r.vehicle_id));
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const serving = branchById.get(servingBranchId);
  if (!serving) return [];

  return vehicles
    .filter((v) => !v.is_offline && !busy.has(v.id))
    .filter((v) => vehicleCanCarry(v, quantityKg, needsColdChain))
    .map((v) => {
      const home = branchById.get(v.branch_id);
      const distance_km = home ? haversine(home.lat, home.lng, serving.lat, serving.lng) : Infinity;
      return {
        vehicle: v,
        distance_km: Number(distance_km.toFixed(2)),
        is_cross_branch: v.branch_id !== servingBranchId,
        home_branch_name: home?.name ?? 'Unknown branch',
      };
    })
    .sort((a, b) => {
      // Own fleet first, then nearest.
      if (a.is_cross_branch !== b.is_cross_branch) return a.is_cross_branch ? 1 : -1;
      return a.distance_km - b.distance_km;
    });
}

/** Rough road time. Singapore urban average ~20km/h door to door, with a fixed
 *  handling allowance so a 0km trip still takes a few minutes. */
export function estimateMinutes(distanceKm: number): number {
  return Math.max(5, Math.round(distanceKm * 3 + 5));
}

/**
 * Where a donation physically is, from the recipient's point of view.
 *
 * A fleet run is a *collection* run — the vehicle drives to the donor, picks the
 * food up, then brings it back to the branch. So the run's status maps onto the
 * food's journey like this:
 *
 *   assigned   -> a vehicle is booked but hasn't set off
 *   en_route   -> driver is on the way TO THE DONOR (food not collected yet)
 *   picked_up  -> collected, now travelling to the branch
 *   completed  -> at the branch, ready to hand over
 *
 * No run at all means the item is already at the branch: either it was seeded
 * there, or no vehicle could be assigned and it was handled off-system. Both
 * cases are safer to present as "here" than to leave permanently in transit.
 */
export type DeliveryStage = 'scheduled' | 'collecting' | 'in_transit' | 'at_branch';

export interface DeliveryProgress {
  stage: DeliveryStage;
  label: string;
  detail: string;
  /** True once the food is physically at the branch and can be handed over. */
  collectable: boolean;
  /** 0-1, for a progress bar. */
  fraction: number;
}

const STAGE_INFO: Record<DeliveryStage, Omit<DeliveryProgress, 'stage'>> = {
  scheduled: {
    label: 'Collection scheduled',
    detail: 'A Willing Hearts vehicle is booked to collect this from the donor.',
    collectable: false,
    fraction: 0.15,
  },
  collecting: {
    label: 'Driver on the way to collect',
    detail: 'Our driver is heading to the donor now. Not yet in our hands.',
    collectable: false,
    fraction: 0.4,
  },
  in_transit: {
    label: 'Collected — on the way to the branch',
    detail: 'Picked up from the donor and travelling to the branch.',
    collectable: false,
    fraction: 0.75,
  },
  at_branch: {
    label: 'At the branch — ready to collect',
    detail: 'This is on the shelf now and can be picked up.',
    collectable: true,
    fraction: 1,
  },
};

export function deliveryProgress(openRunStatus: RunStatus | null | undefined): DeliveryProgress {
  let stage: DeliveryStage = 'at_branch';
  if (openRunStatus === 'assigned') stage = 'scheduled';
  else if (openRunStatus === 'en_route') stage = 'collecting';
  else if (openRunStatus === 'picked_up') stage = 'in_transit';
  return { stage, ...STAGE_INFO[stage] };
}
