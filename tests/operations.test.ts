import { describe, it, expect } from 'vitest';
import {
  vehicleStatus,
  vehicleCanCarry,
  rankDispatchCandidates,
  estimateMinutes,
  deliveryProgress,
  RUN_ADVANCE,
  type VehicleRow,
  type FleetRunRow,
} from '@/lib/fleet';
import {
  ZONES,
  zoneAllocation,
  modelledTemperature,
  zoneHealth,
  rackState,
  describeShelfLife,
} from '@/lib/storage-zones';
import { optimiseRoute, type RouteStop } from '@/lib/routing';
import { beneficiariesForArea, PARTNER_BENEFICIARIES } from '@/lib/data/beneficiaries';

function veh(over: Partial<VehicleRow> & { id: string }): VehicleRow {
  return {
    branch_id: 'b1',
    label: over.id.toUpperCase(),
    type: 'van',
    driver_name: 'Driver',
    capacity_kg: 200,
    is_offline: false,
    ...over,
  };
}

function run(over: Partial<FleetRunRow> & { vehicle_id: string }): FleetRunRow {
  return {
    id: 'r-' + over.vehicle_id,
    listing_id: null,
    serving_branch_id: 'b1',
    status: 'assigned',
    quantity_kg: 10,
    assigned_at: null,
    en_route_at: null,
    picked_up_at: null,
    completed_at: null,
    ...over,
  };
}

const BRANCHES = [
  { id: 'b1', name: 'Woodlands', lat: 1.4382, lng: 103.7891 },
  { id: 'b2', name: 'Yishun', lat: 1.4304, lng: 103.8354 },
  { id: 'b3', name: 'Bukit Merah', lat: 1.2819, lng: 103.8239 },
];

describe('fleet — derived vehicle status', () => {
  it('reports idle when there is no open run', () => {
    expect(vehicleStatus(veh({ id: 'v1' }), undefined)).toBe('idle');
  });

  it('reports the open run status', () => {
    expect(vehicleStatus(veh({ id: 'v1' }), run({ vehicle_id: 'v1', status: 'en_route' }))).toBe('en_route');
    expect(vehicleStatus(veh({ id: 'v1' }), run({ vehicle_id: 'v1', status: 'picked_up' }))).toBe('picked_up');
  });

  it('treats a completed run as idle again, not stuck', () => {
    expect(vehicleStatus(veh({ id: 'v1' }), run({ vehicle_id: 'v1', status: 'completed' }))).toBe('idle');
    expect(vehicleStatus(veh({ id: 'v1' }), run({ vehicle_id: 'v1', status: 'cancelled' }))).toBe('idle');
  });

  it('offline wins over any run state', () => {
    expect(
      vehicleStatus(veh({ id: 'v1', is_offline: true }), run({ vehicle_id: 'v1', status: 'en_route' }))
    ).toBe('offline');
  });
});

describe('fleet — capability checks', () => {
  it('rejects a load heavier than capacity', () => {
    expect(vehicleCanCarry(veh({ id: 'v', capacity_kg: 30 }), 40, false)).toBe(false);
    expect(vehicleCanCarry(veh({ id: 'v', capacity_kg: 200 }), 40, false)).toBe(true);
  });

  it('requires a refrigerated vehicle for cold-chain loads', () => {
    expect(vehicleCanCarry(veh({ id: 'v', type: 'van' }), 10, true)).toBe(false);
    expect(vehicleCanCarry(veh({ id: 'v', type: 'truck' }), 10, true)).toBe(false);
    expect(vehicleCanCarry(veh({ id: 'v', type: 'refrigerated' }), 10, true)).toBe(true);
  });

  it('allows any adequate vehicle when no cold chain is needed', () => {
    for (const type of ['van', 'truck', 'refrigerated'] as const) {
      expect(vehicleCanCarry(veh({ id: 'v', type }), 10, false)).toBe(true);
    }
  });
});

describe('fleet — dispatch ranking', () => {
  const base = { branches: BRANCHES, servingBranchId: 'b1', quantityKg: 20, needsColdChain: false };

  it('prefers the serving branch own vehicle over a closer borrowed one', () => {
    const ranked = rankDispatchCandidates({
      ...base,
      vehicles: [veh({ id: 'own', branch_id: 'b1' }), veh({ id: 'other', branch_id: 'b2' })],
      openRuns: [],
    });
    expect(ranked[0].vehicle.id).toBe('own');
    expect(ranked[0].is_cross_branch).toBe(false);
    expect(ranked[1].is_cross_branch).toBe(true);
  });

  it('falls back to the nearest other branch when the home fleet is busy', () => {
    const ranked = rankDispatchCandidates({
      ...base,
      vehicles: [
        veh({ id: 'own', branch_id: 'b1' }),
        veh({ id: 'near', branch_id: 'b2' }),
        veh({ id: 'far', branch_id: 'b3' }),
      ],
      openRuns: [run({ vehicle_id: 'own', status: 'en_route' })],
    });
    expect(ranked.map((c) => c.vehicle.id)).toEqual(['near', 'far']);
    expect(ranked[0].distance_km).toBeLessThan(ranked[1].distance_km);
  });

  it('excludes busy, offline, and incapable vehicles', () => {
    const ranked = rankDispatchCandidates({
      ...base,
      needsColdChain: true,
      vehicles: [
        veh({ id: 'busy', branch_id: 'b1', type: 'refrigerated' }),
        veh({ id: 'off', branch_id: 'b1', type: 'refrigerated', is_offline: true }),
        veh({ id: 'wrongtype', branch_id: 'b1', type: 'van' }),
        veh({ id: 'toosmall', branch_id: 'b1', type: 'refrigerated', capacity_kg: 5 }),
        veh({ id: 'ok', branch_id: 'b1', type: 'refrigerated' }),
      ],
      openRuns: [run({ vehicle_id: 'busy', status: 'picked_up' })],
    });
    expect(ranked.map((c) => c.vehicle.id)).toEqual(['ok']);
  });

  it('returns nothing when every vehicle is unavailable', () => {
    const ranked = rankDispatchCandidates({
      ...base,
      vehicles: [veh({ id: 'a', branch_id: 'b1' })],
      openRuns: [run({ vehicle_id: 'a', status: 'assigned' })],
    });
    expect(ranked).toEqual([]);
  });

  it('ignores closed runs when deciding who is busy', () => {
    const ranked = rankDispatchCandidates({
      ...base,
      vehicles: [veh({ id: 'a', branch_id: 'b1' })],
      openRuns: [run({ vehicle_id: 'a', status: 'completed' })],
    });
    expect(ranked).toHaveLength(1);
  });
});

describe('fleet — run lifecycle', () => {
  it('advances in order and then stops', () => {
    expect(RUN_ADVANCE.assigned).toBe('en_route');
    expect(RUN_ADVANCE.en_route).toBe('picked_up');
    expect(RUN_ADVANCE.picked_up).toBe('completed');
    expect(RUN_ADVANCE.completed).toBeNull();
    expect(RUN_ADVANCE.cancelled).toBeNull();
  });

  it('estimates a sane minimum travel time', () => {
    expect(estimateMinutes(0)).toBe(5);
    expect(estimateMinutes(10)).toBe(35);
    expect(estimateMinutes(10)).toBeGreaterThan(estimateMinutes(2));
  });
});

describe('delivery progress (public view of where food actually is)', () => {
  it('treats an item with no open run as already at the branch', () => {
    // Seeded stock, or a donation nobody could assign a vehicle to — safer to
    // present as "here" than to strand it in permanent transit.
    expect(deliveryProgress(null).stage).toBe('at_branch');
    expect(deliveryProgress(undefined).collectable).toBe(true);
    expect(deliveryProgress('completed').stage).toBe('at_branch');
    expect(deliveryProgress('cancelled').stage).toBe('at_branch');
  });

  it('maps a collection run onto the food journey', () => {
    expect(deliveryProgress('assigned').stage).toBe('scheduled');
    expect(deliveryProgress('en_route').stage).toBe('collecting');
    expect(deliveryProgress('picked_up').stage).toBe('in_transit');
  });

  it('only allows collection once the food is physically at the branch', () => {
    for (const s of ['assigned', 'en_route', 'picked_up'] as const) {
      expect(deliveryProgress(s).collectable).toBe(false);
    }
    expect(deliveryProgress('completed').collectable).toBe(true);
  });

  it('advances monotonically through the journey', () => {
    const order = ['assigned', 'en_route', 'picked_up', 'completed'] as const;
    const fractions = order.map((s) => deliveryProgress(s).fraction);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    }
    expect(fractions.at(-1)).toBe(1);
  });

  it('never claims the food is in hand while the driver is still outbound', () => {
    // en_route means heading TO the donor — a subtle one to get wrong.
    expect(deliveryProgress('en_route').detail).toMatch(/not yet in our hands/i);
  });
});

describe('storage zones', () => {
  it('gives a branch without cold storage no chilled or frozen allocation', () => {
    const a = zoneAllocation(350, false);
    expect(a.cold).toBe(0);
    expect(a.frozen).toBe(0);
    expect(a.ambient).toBe(350);
  });

  it('splits capacity across all three zones when cold storage exists', () => {
    const a = zoneAllocation(500, true);
    expect(a.ambient + a.cold + a.frozen).toBeCloseTo(500, 0);
    expect(a.cold).toBeGreaterThan(0);
    expect(a.frozen).toBeGreaterThan(0);
  });

  it('models temperature as deterministic and warming with occupancy', () => {
    const chilled = ZONES.find((z) => z.key === 'cold')!;
    const empty = modelledTemperature(chilled, 0);
    const half = modelledTemperature(chilled, 0.5);
    const full = modelledTemperature(chilled, 1);
    expect(empty).toBe(chilled.setpoint_c);
    expect(half).toBeGreaterThan(empty);
    expect(full).toBeGreaterThan(half);
    // Deterministic: same input, same output every time.
    expect(modelledTemperature(chilled, 0.5)).toBe(half);
  });

  it('escalates zone health as temperature drifts from setpoint', () => {
    const chilled = ZONES.find((z) => z.key === 'cold')!;
    expect(zoneHealth(chilled, 4)).toBe('nominal');
    expect(zoneHealth(chilled, 5.5)).toBe('drifting');
    expect(zoneHealth(chilled, 9)).toBe('breach');
  });

  it('classifies rack occupancy into defined bands', () => {
    expect(rackState(10, 100)).toBe('space');
    expect(rackState(70, 100)).toBe('filling');
    expect(rackState(90, 100)).toBe('full');
    expect(rackState(105, 100)).toBe('over');
  });

  it('treats stock in a zero-capacity zone as over capacity', () => {
    // A chilled item at a branch with no chiller — a real flag, not a rounding error.
    expect(rackState(12, 0)).toBe('over');
    expect(rackState(0, 0)).toBe('space');
  });
});

describe('shelf life description', () => {
  const now = Date.now();
  const at = (h: number) => new Date(now + h * 3_600_000).toISOString();

  it('picks a unit that matches the magnitude', () => {
    expect(describeShelfLife(at(0.5), now).label).toMatch(/min left/);
    expect(describeShelfLife(at(5), now).label).toMatch(/h left/);
    expect(describeShelfLife(at(24 * 5), now).label).toMatch(/days left/);
    expect(describeShelfLife(at(24 * 30), now).label).toMatch(/weeks left/);
    expect(describeShelfLife(at(24 * 200), now).label).toMatch(/months left/);
  });

  it('tiers by urgency and flags the past as expired', () => {
    expect(describeShelfLife(at(-1), now).tier).toBe('expired');
    expect(describeShelfLife(at(2), now).tier).toBe('critical');
    expect(describeShelfLife(at(12), now).tier).toBe('urgent');
    expect(describeShelfLife(at(48), now).tier).toBe('monitor');
    expect(describeShelfLife(at(24 * 30), now).tier).toBe('stable');
  });
});

describe('route optimisation', () => {
  const depot: RouteStop = { id: 'd', name: 'Branch', lat: 1.3, lng: 103.8 };
  const stop = (id: string, lat: number, lng: number): RouteStop => ({ id, name: id, lat, lng });

  it('handles an empty stop list', () => {
    const r = optimiseRoute(depot, []);
    expect(r.order).toEqual([]);
    expect(r.total_distance_km).toBe(0);
  });

  it('produces one leg for a single stop', () => {
    const r = optimiseRoute(depot, [stop('a', 1.31, 103.81)]);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].from).toBe('Branch');
    expect(r.method).toBe('exact');
  });

  it('finds the genuinely shortest ordering, not input order', () => {
    // 'far' is listed first but visiting 'near' first is clearly shorter.
    const near = stop('near', 1.305, 103.805);
    const far = stop('far', 1.36, 103.86);
    const r = optimiseRoute(depot, [far, near]);
    expect(r.order.map((s) => s.id)).toEqual(['near', 'far']);
    expect(r.method).toBe('exact');
    expect(r.permutations_considered).toBe(2);
  });

  it('is exhaustive up to 8 stops and reports how many orderings it tried', () => {
    const stops = Array.from({ length: 4 }, (_, i) => stop(`s${i}`, 1.3 + i * 0.02, 103.8 + i * 0.02));
    const r = optimiseRoute(depot, stops);
    expect(r.method).toBe('exact');
    expect(r.permutations_considered).toBe(24); // 4!
    expect(r.order).toHaveLength(4);
  });

  it('switches to a heuristic beyond the exact limit and says so', () => {
    const stops = Array.from({ length: 9 }, (_, i) => stop(`s${i}`, 1.3 + i * 0.01, 103.8 + i * 0.01));
    const r = optimiseRoute(depot, stops);
    expect(r.method).toBe('heuristic');
    expect(r.order).toHaveLength(9);
  });

  it('never loses or duplicates a stop', () => {
    const stops = Array.from({ length: 5 }, (_, i) => stop(`s${i}`, 1.3 + i * 0.03, 103.8 - i * 0.02));
    const r = optimiseRoute(depot, stops);
    expect(new Set(r.order.map((s) => s.id)).size).toBe(5);
    expect(r.legs).toHaveLength(5);
  });

  it('total distance equals the sum of its legs', () => {
    const stops = [stop('a', 1.32, 103.82), stop('b', 1.28, 103.79), stop('c', 1.35, 103.85)];
    const r = optimiseRoute(depot, stops);
    const summed = r.legs.reduce((s, l) => s + l.distance_km, 0);
    expect(r.total_distance_km).toBeCloseTo(summed, 1);
  });
});

describe('partner beneficiary network', () => {
  it('covers every branch region', () => {
    for (const area of ['North', 'Central', 'South', 'East']) {
      expect(PARTNER_BENEFICIARIES[area].length).toBeGreaterThan(0);
    }
  });

  it('gives every partner real coordinates for routing', () => {
    for (const list of Object.values(PARTNER_BENEFICIARIES)) {
      for (const p of list) {
        // Roughly within Singapore's bounding box.
        expect(p.lat).toBeGreaterThan(1.15);
        expect(p.lat).toBeLessThan(1.50);
        expect(p.lng).toBeGreaterThan(103.6);
        expect(p.lng).toBeLessThan(104.1);
      }
    }
  });

  it('returns partners nearest first and falls back for an unknown area', () => {
    const north = beneficiariesForArea('North');
    expect(north[0].minutes_from_branch).toBeLessThanOrEqual(north[1].minutes_from_branch);
    expect(beneficiariesForArea(null).length).toBeGreaterThan(0);
    expect(beneficiariesForArea('Atlantis').length).toBeGreaterThan(0);
  });
});
