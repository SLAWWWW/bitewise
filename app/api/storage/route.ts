import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  ZONES,
  zoneAllocation,
  modelledTemperature,
  zoneHealth,
  rackState,
  describeShelfLife,
} from '@/lib/storage-zones';
import { ESCALATION_THRESHOLD_HOURS } from '@/lib/constants';
import { deliveryProgress, isOpenRun, type FleetRunRow } from '@/lib/fleet';
import type { Branch, InventoryItem, StorageType } from '@/lib/types';

/**
 * Storage management: every branch broken into its zones, each zone's rack
 * occupancy and modelled temperature, and each item's shelf life plus whether
 * it's publicly listed, reserved, or already escalated to a partner.
 *
 * All of it derives from `inventory_items` and `branches` — there is no separate
 * zone or sensor table, so this view can't disagree with the inventory it
 * describes.
 */
export async function GET() {
  const supabase = createServerClient();

  const [branchesRes, claimsRes, runsRes] = await Promise.all([
    supabase.from('branches').select('*').order('name'),
    supabase.from('claims').select('inventory_item_id, status, pickup_deadline_at'),
    supabase.from('fleet_runs').select('*'),
  ]);

  // Provenance join needs 007; fall back to plain rows so the page still works.
  let itemsRes = await supabase
    .from('inventory_items')
    .select('*, listing:food_listings(donor:donors(name))')
    .order('expiry_at');

  if (itemsRes.error) {
    console.error(
      '[storage] provenance join failed; serving without donor/delivery detail. ' +
        'Run supabase/migrations/007_inventory_provenance.sql. Cause:',
      itemsRes.error.message
    );
    itemsRes = await supabase.from('inventory_items').select('*').order('expiry_at');
  }

  if (branchesRes.error) return NextResponse.json({ error: branchesRes.error.message }, { status: 500 });
  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });

  const branches = (branchesRes.data ?? []) as Branch[];
  const items = (itemsRes.data ?? []) as (InventoryItem & {
    listing_id?: string | null;
    listing?: { donor?: { name: string } | null } | null;
  })[];
  const claims = claimsRes.data ?? [];

  const claimedIds = new Set(claims.map((c) => c.inventory_item_id));
  const deadlineByItem = new Map(
    claims.filter((c) => c.status === 'claimed').map((c) => [c.inventory_item_id, c.pickup_deadline_at as string | null])
  );

  // Open collection runs, so staff see stock that is counted at a branch but
  // hasn't physically arrived yet. Fleet is optional (migration 006).
  const openRunByListing = new Map<string, FleetRunRow>();
  if (!runsRes.error) {
    for (const r of (runsRes.data ?? []) as FleetRunRow[]) {
      if (r.listing_id && isOpenRun(r.status)) openRunByListing.set(r.listing_id, r);
    }
  }

  const now = Date.now();

  const branchViews = branches.map((branch) => {
    const allocation = zoneAllocation(branch.capacity_kg, branch.has_cold_storage);
    const branchItems = items.filter((i) => i.branch_id === branch.id);

    const zones = ZONES.map((zone) => {
      const zoneItems = branchItems.filter((i) => i.storage_type === zone.key);
      // A picked-up item has physically left the branch — it stays visible
      // below (with its own "Picked up" badge, as confirmation staff can see
      // the action landed) but must not keep occupying rack space forever.
      const occupying = zoneItems.filter((i) => i.status !== 'distributed');
      const usedKg = occupying.reduce((sum, i) => sum + (i.quantity ?? 0), 0);
      const capacityKg = allocation[zone.key as StorageType];
      const occupancy = capacityKg > 0 ? usedKg / capacityKg : usedKg > 0 ? 1.2 : 0;
      const temperature_c = modelledTemperature(zone, occupancy);

      const enriched = zoneItems.map((item) => {
        const shelf = describeShelfLife(item.expiry_at, now);
        const openRun = item.listing_id ? openRunByListing.get(item.listing_id) : undefined;
        const delivery = deliveryProgress(openRun?.status ?? null);
        return {
          id: item.id,
          listing_id: item.listing_id ?? null,
          item_name: item.item_name,
          food_type: item.food_type,
          quantity: item.quantity,
          unit: item.unit,
          status: item.status,
          expiry_at: item.expiry_at,
          shelf_life_label: shelf.label,
          shelf_life_hours: Number(shelf.hours.toFixed(2)),
          urgency: shelf.tier,
          // Counted against this zone but possibly still on the road.
          delivery,
          donated_by: item.listing?.donor?.name ?? null,
          // The four states staff ask about, stated explicitly rather than
          // left for them to infer from a status string. The claimedIds
          // fallback only widens the 'in_stock' case (an orphaned claim on a
          // row that never flipped status) — a 'distributed' item must never
          // also read as 'reserved' just because its claim row still exists.
          publicly_listed: item.status === 'in_stock',
          reserved: item.status === 'reserved' || (item.status === 'in_stock' && claimedIds.has(item.id)),
          escalated: item.status === 'escalated',
          distributed: item.status === 'distributed',
          within_escalation_window: shelf.hours > 0 && shelf.hours <= ESCALATION_THRESHOLD_HOURS,
          pickup_deadline_at: deadlineByItem.get(item.id) ?? null,
        };
      });

      return {
        key: zone.key,
        label: zone.label,
        description: zone.description,
        setpoint_c: zone.setpoint_c,
        tolerance_c: zone.tolerance_c,
        temperature_c,
        health: zoneHealth(zone, temperature_c),
        capacity_kg: capacityKg,
        used_kg: Number(usedKg.toFixed(1)),
        occupancy_pct: capacityKg > 0 ? Math.round(occupancy * 100) : usedKg > 0 ? 999 : 0,
        rack_state: rackState(usedKg, capacityKg),
        // A chilled item at a branch with no chiller is a genuine operational
        // fault, not a display quirk — surface it rather than hiding it.
        unsupported_zone: capacityKg === 0 && occupying.length > 0,
        item_count: occupying.length,
        items: enriched,
      };
    });

    return {
      branch_id: branch.id,
      branch_name: branch.name,
      area: branch.area,
      color: branch.color,
      capacity_kg: branch.capacity_kg,
      current_load_kg: branch.current_load_kg,
      has_cold_storage: branch.has_cold_storage,
      has_cooking: branch.has_cooking,
      zones,
      total_items: branchItems.filter((i) => i.status !== 'distributed').length,
    };
  });

  const allZones = branchViews.flatMap((b) => b.zones);
  const summary = {
    branches: branchViews.length,
    total_items: items.filter((i) => i.status !== 'distributed').length,
    racks_full: allZones.filter((z) => z.rack_state === 'full' || z.rack_state === 'over').length,
    zones_out_of_range: allZones.filter((z) => z.health !== 'nominal').length,
    unsupported_placements: allZones.filter((z) => z.unsupported_zone).length,
    publicly_listed: items.filter((i) => i.status === 'in_stock').length,
    reserved: items.filter((i) => i.status === 'reserved').length,
    escalated: items.filter((i) => i.status === 'escalated').length,
    distributed: items.filter((i) => i.status === 'distributed').length,
    in_transit: allZones.reduce(
      (n, z) => n + z.items.filter((i) => !i.delivery.collectable).length,
      0
    ),
  };

  return NextResponse.json({ branches: branchViews, summary });
}
