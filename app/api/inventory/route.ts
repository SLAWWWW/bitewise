import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { ESCALATION_THRESHOLD_HOURS } from '@/lib/constants';
import { deliveryProgress, isOpenRun, type FleetRunRow } from '@/lib/fleet';
import { autoRecycleExpiredEscalations } from '@/lib/inventory-sweep';
import { describeShelfLife } from '@/lib/storage-zones';
import { guidelineForFoodType } from '@/lib/knowledge/food-safety';
import type { FoodType, InventoryItem, StorageType } from '@/lib/types';

/** Plain-language handling guidance shown to whoever collects the food. */
const STORAGE_ADVICE: Record<StorageType, string> = {
  frozen: 'Keep frozen. Bring an insulated bag and get it home quickly.',
  cold: 'Needs to stay chilled. Bring a cooler bag and refrigerate as soon as you get home.',
  ambient: 'No refrigeration needed — store somewhere cool and dry.',
};

export async function GET() {
  const supabase = createServerClient();

  // Lazily release reservations whose agent-computed pickup countdown (§7.8)
  // ran out with no confirmed pickup — same no-cron, sweep-on-read pattern as
  // the escalation/expiry sweeps below, and deliberately runs first: an item
  // freed here should immediately be re-evaluated by the escalation sweep on
  // its own current shelf life, not skip a cycle.
  const { data: overdue, error: overdueError } = await supabase
    .from('claims')
    .select('id, inventory_item_id')
    .eq('status', 'claimed')
    .lt('pickup_deadline_at', new Date().toISOString());

  if (overdueError) {
    // Missing pickup_deadline_at (migration 009 not applied) means this
    // query itself fails — nothing to sweep, no reservations ever release
    // automatically, but every other read still succeeds.
    if (!overdueError.message.includes('pickup_deadline_at')) {
      console.error('[inventory] no-show sweep query failed:', overdueError.message);
    }
  } else if (overdue && overdue.length > 0) {
    const claimIds = overdue.map((c) => c.id);
    const itemIds = overdue.map((c) => c.inventory_item_id);
    await supabase.from('claims').update({ status: 'no_show' }).in('id', claimIds);
    await supabase.from('inventory_items').update({ status: 'in_stock' }).in('id', itemIds).eq('status', 'reserved');
  }

  // Lazily escalate unclaimed items nearing expiry to partner-beneficiary
  // dispatch instead of leaving them to expire unclaimed on the public app —
  // no cron needed, this just runs on every read.
  //
  // The error is checked rather than ignored: this update depends on
  // 003_escalation.sql having widened the inventory_items status CHECK
  // constraint to allow 'escalated'. When that migration hadn't been run, the
  // update failed with a constraint violation on every request and the whole
  // escalation feature silently did nothing — a swallowed error is what let
  // that go unnoticed. Read requests still succeed if this fails (escalation
  // is a background nicety, not something worth 500ing a page over), but it
  // now says so loudly in the server logs.
  const cutoff = new Date(Date.now() + ESCALATION_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();
  const { error: escalationError } = await supabase
    .from('inventory_items')
    .update({ status: 'escalated' })
    .eq('status', 'in_stock')
    .lte('expiry_at', cutoff);

  if (escalationError) {
    console.error(
      `[inventory] near-expiry escalation failed — items within ${ESCALATION_THRESHOLD_HOURS}h of expiry ` +
        `will NOT be routed to partner beneficiaries. If this mentions "inventory_items_status_check", ` +
        `run supabase/migrations/003_escalation.sql. Cause:`,
      escalationError.message
    );
  }

  // Retire anything that has actually passed its expiry. Without this, stock
  // that was never claimed publicly stays 'in_stock'/'reserved' forever
  // instead of ever becoming recyclable.
  const { error: expiryError } = await supabase
    .from('inventory_items')
    .update({ status: 'expired' })
    .in('status', ['in_stock', 'reserved'])
    .lt('expiry_at', new Date().toISOString());

  if (expiryError) {
    console.error('[inventory] retiring past-expiry stock failed:', expiryError.message);
  }

  // 'escalated' items are already committed to a specific partner beneficiary
  // — there's no walk-in claimant checkpoint that applies to them, so a
  // spoiled one is auto-completed as recycled here instead of joining the
  // generic expired-stock sweep above (which would otherwise leave it stuck
  // showing "Expired on the shelf" despite never having been publicly listed).
  await autoRecycleExpiredEscalations(supabase);

  const BRANCH_JOIN = 'branch:branches(id, name, area, color, organization_name)';
  const LISTING_JOIN =
    'listing:food_listings(id, item_name, storage_type, expiry_at, created_at, donor:donors(name, type))';

  // The listing join only resolves once 007_inventory_provenance.sql has added
  // inventory_items.listing_id. Without it PostgREST can't find the
  // relationship and errors the whole query — which would take the public food
  // list down with it. Retry without provenance instead: recipients lose the
  // donor name and live delivery progress, not the page.
  let { data, error } = await supabase
    .from('inventory_items')
    .select(`*, ${BRANCH_JOIN}, ${LISTING_JOIN}`)
    .order('expiry_at', { ascending: true });

  if (error) {
    console.error(
      '[inventory] provenance join failed; serving without donor/delivery detail. ' +
        'If this mentions a relationship to food_listings, run ' +
        'supabase/migrations/007_inventory_provenance.sql. Cause:',
      error.message
    );
    ({ data, error } = await supabase
      .from('inventory_items')
      .select(`*, ${BRANCH_JOIN}`)
      .order('expiry_at', { ascending: true }));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []) as (InventoryItem & {
    listing_id?: string | null;
    listing?: { donor?: { name: string; type: string } | null; created_at?: string } | null;
  })[];

  // One query for the open collection runs, so each item can report where it
  // physically is rather than assuming it's already on the shelf.
  const listingIds = items.map((i) => i.listing_id).filter((v): v is string => !!v);
  const openRunByListing = new Map<string, FleetRunRow>();

  if (listingIds.length > 0) {
    const { data: runs, error: runsError } = await supabase
      .from('fleet_runs')
      .select('*')
      .in('listing_id', listingIds);
    // Fleet is optional: without migration 006 there are no runs, and every item
    // is simply reported as already at the branch.
    if (!runsError) {
      for (const r of (runs ?? []) as FleetRunRow[]) {
        if (r.listing_id && isOpenRun(r.status)) openRunByListing.set(r.listing_id, r);
      }
    }
  }

  // The active claim's countdown, per reserved item — best-effort, since
  // pickup_deadline_at only exists once migration 009 is applied.
  const deadlineByItem = new Map<string, string | null>();
  const reservedIds = items.filter((i) => i.status === 'reserved').map((i) => i.id);
  if (reservedIds.length > 0) {
    const { data: activeClaims } = await supabase
      .from('claims')
      .select('inventory_item_id, pickup_deadline_at')
      .in('inventory_item_id', reservedIds)
      .eq('status', 'claimed');
    for (const c of activeClaims ?? []) deadlineByItem.set(c.inventory_item_id, c.pickup_deadline_at);
  }

  const now = Date.now();

  const enriched = items.map((item) => {
    const openRun = item.listing_id ? openRunByListing.get(item.listing_id) : undefined;
    const progress = deliveryProgress(openRun?.status ?? null);
    const shelf = describeShelfLife(item.expiry_at, now);
    const foodType = item.food_type as FoodType;
    const storageType = item.storage_type as StorageType;

    return {
      ...item,
      // Everything a recipient needs to decide whether to collect it.
      shelf_life_label: shelf.label,
      shelf_life_hours: Number(shelf.hours.toFixed(2)),
      urgency: shelf.tier,
      storage_advice: STORAGE_ADVICE[storageType] ?? STORAGE_ADVICE.ambient,
      safety_note: guidelineForFoodType(foodType),
      donated_by: item.listing?.donor?.name ?? null,
      donor_type: item.listing?.donor?.type ?? null,
      listed_at: item.listing?.created_at ?? item.created_at,
      delivery: progress,
      publicly_listed: item.status === 'in_stock',
      reserved: item.status === 'reserved',
      escalated: item.status === 'escalated',
      distributed: item.status === 'distributed',
      pickup_deadline_at: deadlineByItem.get(item.id) ?? null,
    };
  });

  return NextResponse.json({ items: enriched });
}
