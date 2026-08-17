import { beneficiariesForArea, type PartnerBeneficiary } from '@/lib/data/beneficiaries';
import { optimiseRoute, type RouteStop } from '@/lib/routing';
import { describeShelfLife } from '@/lib/storage-zones';
import { rankDispatchCandidates, type FleetRunRow, type VehicleRow } from '@/lib/fleet';
import type { Branch, InventoryItem } from '@/lib/types';

/** Cold-chain food can only go to a partner that can receive it that way. */
function partnerAccepts(partner: PartnerBeneficiary, item: InventoryItem): boolean {
  const needsCold = item.storage_type === 'cold' || item.storage_type === 'frozen';
  if (needsCold && !partner.accepts.needs_cold_chain) return false;
  if (item.food_type === 'cooked' && !partner.accepts.cooked) return false;
  return true;
}

export interface PlannedDispatchRun {
  branch_id: string;
  branch_name: string;
  area: string | null;
  color: string;
  item_count: number;
  total_kg: number;
  needs_cold_chain: boolean;
  soonest_expiry_hours: number;
  route_exceeds_shelf_life: boolean;
  assignments: {
    item_id: string;
    item_name: string;
    food_type: string;
    storage_type: string;
    quantity: number;
    unit: string;
    shelf_life_label: string;
    shelf_life_hours: number;
    urgency: string;
    partner_name: string;
    partner_type: string;
    compromised: boolean;
  }[];
  stops: {
    sequence: number;
    name: string;
    type: string;
    serves: number;
    note: string;
    items: number;
    kg: number;
  }[];
  route: {
    legs: unknown;
    total_distance_km: number;
    total_minutes: number;
    method: string;
    permutations_considered: number;
  };
  suggested_vehicle: {
    label: string;
    type: string;
    driver_name: string;
    capacity_kg: number;
    is_cross_branch: boolean;
    home_branch_name: string;
  } | null;
  fleet_available: boolean;
  no_vehicle_reason: string | null;
}

/**
 * Builds the most efficient multi-stop partner-delivery route per branch —
 * one item-to-partner assignment pass, then a route through the resulting
 * stops, then the best available vehicle for the job. Shared by the
 * read-only dispatch-planning view (`/api/dispatch`, GET) and the scheduled
 * daily dispatch (`/api/cron/dispatch-partners`) so both agree on what
 * "efficient" means — this is the one place that logic lives.
 */
export function planDispatchRuns(input: {
  branches: Branch[];
  escalatedItems: InventoryItem[];
  vehicles: VehicleRow[];
  openRuns: FleetRunRow[];
  fleetAvailable: boolean;
  now: number;
}): PlannedDispatchRun[] {
  const { branches, escalatedItems, vehicles, openRuns, fleetAvailable, now } = input;

  return branches
    .map((branch) => {
      // Only still-edible stock is worth planning a run for. Anything already
      // past expiry belongs in a write-off, not a delivery van.
      const items = escalatedItems.filter(
        (i) => i.branch_id === branch.id && new Date(i.expiry_at).getTime() > now
      );
      if (items.length === 0) return null;

      const partners = beneficiariesForArea(branch.area);

      const assignments = items.map((item) => {
        const partner = partners.find((p) => partnerAccepts(p, item)) ?? partners[0];
        const shelf = describeShelfLife(item.expiry_at, now);
        return {
          item_id: item.id,
          item_name: item.item_name,
          food_type: item.food_type,
          storage_type: item.storage_type,
          quantity: item.quantity,
          unit: item.unit,
          shelf_life_label: shelf.label,
          shelf_life_hours: Number(shelf.hours.toFixed(2)),
          urgency: shelf.tier,
          partner_name: partner.name,
          partner_type: partner.type.replace(/_/g, ' '),
          compromised: !partnerAccepts(partner, item),
        };
      });

      const stopNames = [...new Set(assignments.map((a) => a.partner_name))];
      const stops: RouteStop[] = stopNames.map((name) => {
        const p = partners.find((x) => x.name === name)!;
        return { id: name, name, lat: p.lat, lng: p.lng };
      });

      const route = optimiseRoute(
        { id: branch.id, name: branch.name.replace('Willing Hearts — ', ''), lat: branch.lat, lng: branch.lng },
        stops
      );

      const totalKg = assignments.reduce((s, a) => s + (a.quantity ?? 0), 0);
      const needsColdChain = items.some((i) => i.storage_type === 'cold' || i.storage_type === 'frozen');

      const candidates = fleetAvailable
        ? rankDispatchCandidates({
            vehicles,
            openRuns,
            branches: branches.map((b) => ({ id: b.id, name: b.name, lat: b.lat, lng: b.lng })),
            servingBranchId: branch.id,
            quantityKg: totalKg,
            needsColdChain,
          })
        : [];

      const soonest = Math.min(...assignments.map((a) => a.shelf_life_hours));

      return {
        branch_id: branch.id,
        branch_name: branch.name,
        area: branch.area,
        color: branch.color,
        item_count: assignments.length,
        total_kg: Number(totalKg.toFixed(1)),
        needs_cold_chain: needsColdChain,
        soonest_expiry_hours: Number(soonest.toFixed(2)),
        route_exceeds_shelf_life: route.total_minutes / 60 > soonest,
        assignments,
        stops: route.order.map((s, i) => {
          const p = partners.find((x) => x.name === s.name)!;
          const forStop = assignments.filter((a) => a.partner_name === s.name);
          return {
            sequence: i + 1,
            name: s.name,
            type: p.type.replace(/_/g, ' '),
            serves: p.serves,
            note: p.note,
            items: forStop.length,
            kg: Number(forStop.reduce((sum, a) => sum + (a.quantity ?? 0), 0).toFixed(1)),
          };
        }),
        route: {
          legs: route.legs,
          total_distance_km: route.total_distance_km,
          total_minutes: route.total_minutes,
          method: route.method,
          permutations_considered: route.permutations_considered,
        },
        suggested_vehicle: candidates[0]
          ? {
              label: candidates[0].vehicle.label,
              type: candidates[0].vehicle.type,
              driver_name: candidates[0].vehicle.driver_name,
              capacity_kg: candidates[0].vehicle.capacity_kg,
              is_cross_branch: candidates[0].is_cross_branch,
              home_branch_name: candidates[0].home_branch_name,
            }
          : null,
        fleet_available: fleetAvailable,
        no_vehicle_reason: !fleetAvailable
          ? 'Fleet tables not set up — run migration 006 to see vehicle suggestions.'
          : candidates.length === 0
            ? needsColdChain
              ? 'No refrigerated vehicle free anywhere in the network right now.'
              : 'No vehicle with enough capacity is free right now.'
            : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.soonest_expiry_hours - b.soonest_expiry_hours);
}
