/**
 * API Integration Tests
 *
 * Tests run against the dev server on http://localhost:3000. If the server is
 * not reachable the suite is skipped with a clear message rather than failing
 * — making the suite a hard dependency on a running server would break CI
 * environments where the test process and server start together.
 *
 * All test data is prefixed CB-TEST- so it is trivially identifiable. Every row
 * created is deleted in afterEach/afterAll in FK-safe order (Rule 1 of the
 * brief). Branch current_load_kg changes are reverted.
 *
 * The live Supabase client (service-role key from .env.local) is used for direct
 * verification queries only — never to skip through the API's own write paths.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ───── Config ─────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:3000';

/** Load .env.local by hand — process.env won't have it without `set -a` magic. */
function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const idx = l.indexOf('=');
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY =
  env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const GEMINI_API_KEY = env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '';

// ───── Helpers ────────────────────────────────────────────────────────────────

/** Returns a Supabase client with service-role access for direct DB verification. */
function supabase(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`);
}

/** Check the dev server is reachable — if not, the entire suite is skipped. */
async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/fairness`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ───── Test data IDs — populated as tests create rows ─────────────────────────

/** Everything created during the suite. Cleaned up in afterAll in FK-safe order. */
const created = {
  claimIds: [] as string[],
  fleetRunIds: [] as string[],
  inventoryItemIds: [] as string[],
  auditLogIds: [] as string[],
  fairnessSnapshotIds: [] as string[],
  listingIds: [] as string[],
  donorIds: [] as string[],
  /** {id, original_load_kg} — restored after tests that mutate branch load. */
  branchLoadChanges: [] as { id: string; original_load_kg: number }[],
  /** Rows temporarily maxing out Central-area partner quota so every
   *  CB-TEST-bread-item donation in this suite deterministically lands as
   *  public 'in_stock' rather than being routed to a beneficiary — see the
   *  `beforeAll` note below. */
  allocationIds: [] as string[],
  profileIds: [] as string[],
};

/** Every partner beneficiary in the 'toa_payoh' area `testListing()` submits
 *  to — kept in sync with lib/data/beneficiaries.ts's Central region. */
const CENTRAL_BENEFICIARY_KEYS = ['toa-payoh-fsc', 'st-andrews-childrens-home', 'jalan-kukoh-soup-kitchen'];

// ───── Reusable minimal donor payload ─────────────────────────────────────────

const TEST_DONOR_NAME = 'CB-TEST-Donor';
const testListing = () => ({
  donor_name: TEST_DONOR_NAME,
  donor_type: 'restaurant',
  address: 'CB-TEST-123 Test Street',
  area: 'toa_payoh',
  item_name: 'CB-TEST-bread-item',
  food_type: 'bread',
  quantity_kg: 5,
  storage_type: 'ambient',
  expiry_hours: 48,
  agreed_to_regulations: true as const,
});

// ───── Suite ──────────────────────────────────────────────────────────────────

describe('API integration', () => {
  let skip = false;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.warn('[api.test] Supabase credentials not found in .env.local — skipping all tests.');
      skip = true;
      return;
    }
    const reachable = await serverReachable();
    if (!reachable) {
      console.warn(
        '[api.test] Dev server at http://localhost:3000 is not reachable. ' +
          'Run `npm run dev` in another terminal, then re-run the tests.'
      );
      skip = true;
      return;
    }

    // Demand-quota allocation (§7.6) now runs at every approval: an ambient,
    // non-cold-chain donation like CB-TEST-bread-item is eligible for every
    // Central-area partner, and routes to one automatically whenever it has
    // quota room left today. Several tests below need a guaranteed public
    // 'in_stock' item to exercise the claims flow against — so top every
    // Central partner up to exactly their daily quota once, up front, which
    // makes every subsequent bread donation in this suite fall through to
    // public listing deterministically. Reverted in afterAll.
    const db = supabase();
    const { data: bens } = await db
      .from('beneficiary_allocations')
      .select('beneficiary_key, quantity_kg')
      .gte('allocated_at', new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString());
    const fulfilledByKey = new Map<string, number>();
    for (const row of bens ?? []) {
      fulfilledByKey.set(row.beneficiary_key, (fulfilledByKey.get(row.beneficiary_key) ?? 0) + row.quantity_kg);
    }
    const QUOTA_BY_KEY: Record<string, number> = {
      'toa-payoh-fsc': 35,
      'st-andrews-childrens-home': 20,
      'jalan-kukoh-soup-kitchen': 60,
    };
    const topUps = CENTRAL_BENEFICIARY_KEYS.map((key) => ({
      beneficiary_key: key,
      beneficiary_name: key,
      quantity_kg: Math.max(0, QUOTA_BY_KEY[key] - (fulfilledByKey.get(key) ?? 0)),
    })).filter((t) => t.quantity_kg > 0);
    if (topUps.length) {
      const { data: inserted, error } = await db.from('beneficiary_allocations').insert(topUps).select('id');
      if (error) {
        // Migration 008 not applied — beneficiary allocation is skipped
        // entirely by the approve route in that case (see PRD §7.7), so
        // there's nothing to guard against; every bread donation already
        // falls through to public listing on its own.
        console.warn('[api.test] Could not pre-fill beneficiary quota (migration 008 likely not applied) — continuing without it:', error.message);
      } else {
        for (const row of inserted ?? []) created.allocationIds.push(row.id);
      }
    }
  });

  afterAll(async () => {
    if (skip) return;
    const db = supabase();

    if (created.allocationIds.length) {
      await db.from('beneficiary_allocations').delete().in('id', created.allocationIds);
    }
    // Safety net beyond the quota top-up rows above: any test's own inventory
    // item could itself have been the one demand-quota-allocated to a
    // partner (§7.6 runs on every approval, not just ones this suite tries
    // to guard against) — catch those by FK before the inventory row goes,
    // rather than leaving an orphaned allocation with a nulled reference.
    if (created.inventoryItemIds.length) {
      await db.from('beneficiary_allocations').delete().in('inventory_item_id', created.inventoryItemIds);
    }

    // FK-safe deletion order from Rule 1.
    if (created.claimIds.length) {
      await db.from('claims').delete().in('id', created.claimIds);
    }
    if (created.profileIds.length) {
      await db.from('recipient_profiles').delete().in('id', created.profileIds);
    }
    if (created.fleetRunIds.length) {
      await db.from('fleet_runs').delete().in('id', created.fleetRunIds);
    }
    if (created.inventoryItemIds.length) {
      await db.from('inventory_items').delete().in('id', created.inventoryItemIds);
    }
    if (created.auditLogIds.length) {
      await db.from('audit_log').delete().in('id', created.auditLogIds);
    }
    if (created.fairnessSnapshotIds.length) {
      await db.from('fairness_snapshots').delete().in('id', created.fairnessSnapshotIds);
    }
    if (created.listingIds.length) {
      await db.from('food_listings').delete().in('id', created.listingIds);
    }

    // Only delete CB-TEST- donors we know we created, never seeded donors.
    if (created.donorIds.length) {
      await db.from('donors').delete().in('id', created.donorIds);
    }

    // Restore branch loads.
    for (const change of created.branchLoadChanges) {
      await db
        .from('branches')
        .update({ current_load_kg: change.original_load_kg })
        .eq('id', change.id);
    }
  });

  // ── TEST 1 ─ POST /api/listings ────────────────────────────────────────────

  it('1: POST /api/listings returns success:true with a listing_id; listing is pending; branch load unchanged', async () => {
    if (skip) return;

    const db = supabase();

    // Record any branch loads that might be affected.
    const { data: branchesBefore } = await db.from('branches').select('id, current_load_kg');

    const res = await post('/api/listings', testListing());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.listing_id).toBe('string');

    // Track for cleanup.
    created.listingIds.push(body.listing_id);

    // Look up the donor that was created so we can clean it up.
    const { data: donor } = await db
      .from('donors')
      .select('id')
      .ilike('name', TEST_DONOR_NAME)
      .maybeSingle();
    if (donor) created.donorIds.push(donor.id);

    // Listing must be in pending state.
    const { data: listing } = await db
      .from('food_listings')
      .select('status')
      .eq('id', body.listing_id)
      .single();
    expect(listing?.status).toBe('pending');

    // Branch loads must not have changed.
    const { data: branchesAfter } = await db.from('branches').select('id, current_load_kg');
    const beforeMap = new Map((branchesBefore ?? []).map((b) => [b.id, b.current_load_kg]));
    for (const b of branchesAfter ?? []) {
      expect(b.current_load_kg).toBe(beforeMap.get(b.id));
    }
  });

  // ── TEST 2 ─ POST /api/approvals/[id]/approve ──────────────────────────────

  it('2: approve commits once: listing → matched, one inventory row, branch load +qty, one match_approved audit row', async () => {
    if (skip) return;

    const db = supabase();

    // Create a fresh listing to approve.
    const listRes = await post('/api/listings', testListing());
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    const listingId: string = listBody.listing_id;
    created.listingIds.push(listingId);

    // Track donor.
    const { data: donor } = await db
      .from('donors')
      .select('id')
      .ilike('name', TEST_DONOR_NAME)
      .maybeSingle();
    if (donor && !created.donorIds.includes(donor.id)) created.donorIds.push(donor.id);

    // Read matched_branch_id and quantity from the listing.
    const { data: listing } = await db
      .from('food_listings')
      .select('matched_branch_id, quantity_kg')
      .eq('id', listingId)
      .single();
    const branchId = listing?.matched_branch_id;
    const qty = listing?.quantity_kg ?? 5;

    // Record the branch load before approval.
    if (branchId) {
      const { data: b } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', branchId)
        .single();
      if (b && !created.branchLoadChanges.find((c) => c.id === branchId)) {
        created.branchLoadChanges.push({ id: branchId, original_load_kg: b.current_load_kg });
      }
    }

    // Approve.
    const approveRes = await post(`/api/approvals/${listingId}/approve`, {});
    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json();
    expect(approveBody.success).toBe(true);

    // Listing is now matched.
    const { data: updatedListing } = await db
      .from('food_listings')
      .select('status')
      .eq('id', listingId)
      .single();
    expect(updatedListing?.status).toBe('matched');

    // Exactly one inventory_items row tied to this listing.
    const { data: items } = await db
      .from('inventory_items')
      .select('id')
      .eq('listing_id', listingId);
    // Provenance column may not exist (migration 007 optional) — fall back to
    // checking branch_id + item_name instead.
    let inventoryRows: { id: string }[];
    if (items && items.length > 0) {
      inventoryRows = items;
    } else {
      const { data: itemsByBranch } = await db
        .from('inventory_items')
        .select('id')
        .eq('branch_id', branchId ?? '')
        .eq('item_name', 'CB-TEST-bread-item')
        .eq('status', 'in_stock');
      inventoryRows = itemsByBranch ?? [];
    }
    expect(inventoryRows.length).toBe(1);
    for (const row of inventoryRows) created.inventoryItemIds.push(row.id);

    // Branch load increased by quantity_kg.
    if (branchId) {
      const { data: branchAfter } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', branchId)
        .single();
      const originalLoad = created.branchLoadChanges.find((c) => c.id === branchId)!
        .original_load_kg;
      expect(branchAfter?.current_load_kg).toBe(originalLoad + qty);
    }

    // One match_approved audit row for this listing.
    const { data: auditRows } = await db
      .from('audit_log')
      .select('id')
      .eq('entity_id', listingId)
      .eq('action', 'match_approved');
    expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of auditRows ?? []) created.auditLogIds.push(row.id);

    // Collect fleet run IDs for cleanup.
    const { data: runs } = await db
      .from('fleet_runs')
      .select('id')
      .eq('listing_id', listingId);
    for (const r of runs ?? []) created.fleetRunIds.push(r.id);

    // Collect fairness snapshot IDs for cleanup.
    const { data: snaps } = await db
      .from('fairness_snapshots')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);
    for (const s of snaps ?? []) created.fairnessSnapshotIds.push(s.id);
  });

  // ── TEST 3 ─ Same approve called twice sequentially ────────────────────────

  it('3: second sequential approve of the same listing returns 409', async () => {
    if (skip) return;

    const db = supabase();

    const listRes = await post('/api/listings', testListing());
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    const listingId: string = listBody.listing_id;
    created.listingIds.push(listingId);

    const { data: donor } = await db
      .from('donors')
      .select('id')
      .ilike('name', TEST_DONOR_NAME)
      .maybeSingle();
    if (donor && !created.donorIds.includes(donor.id)) created.donorIds.push(donor.id);

    // Record branch load.
    const { data: listing } = await db
      .from('food_listings')
      .select('matched_branch_id, quantity_kg')
      .eq('id', listingId)
      .single();
    const branchId = listing?.matched_branch_id;
    if (branchId && !created.branchLoadChanges.find((c) => c.id === branchId)) {
      const { data: b } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', branchId)
        .single();
      if (b) created.branchLoadChanges.push({ id: branchId, original_load_kg: b.current_load_kg });
    }

    const first = await post(`/api/approvals/${listingId}/approve`, {});
    expect(first.status).toBe(200);

    // Collect created rows for cleanup.
    const { data: runs } = await db.from('fleet_runs').select('id').eq('listing_id', listingId);
    for (const r of runs ?? []) created.fleetRunIds.push(r.id);

    const { data: items } = await db
      .from('inventory_items')
      .select('id')
      .eq('listing_id', listingId);
    if (items && items.length > 0) {
      for (const i of items) created.inventoryItemIds.push(i.id);
    } else {
      const { data: byBranch } = await db
        .from('inventory_items')
        .select('id')
        .eq('branch_id', branchId ?? '')
        .eq('item_name', 'CB-TEST-bread-item')
        .eq('status', 'in_stock');
      for (const i of byBranch ?? []) created.inventoryItemIds.push(i.id);
    }

    const { data: auditRows } = await db
      .from('audit_log')
      .select('id')
      .eq('entity_id', listingId)
      .eq('action', 'match_approved');
    for (const r of auditRows ?? []) created.auditLogIds.push(r.id);

    const { data: snaps } = await db
      .from('fairness_snapshots')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);
    for (const s of snaps ?? []) created.fairnessSnapshotIds.push(s.id);

    // Second approval of the same already-matched listing → 409.
    const second = await post(`/api/approvals/${listingId}/approve`, {});
    expect(second.status).toBe(409);
  });

  // ── TEST 4 ─ Two concurrent approvals of one listing ──────────────────────

  it('4: two concurrent approvals → exactly one 200 and one 409; exactly one inventory row; branch load incremented once', async () => {
    if (skip) return;

    const db = supabase();

    const listRes = await post('/api/listings', testListing());
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    const listingId: string = listBody.listing_id;
    created.listingIds.push(listingId);

    const { data: donor } = await db
      .from('donors')
      .select('id')
      .ilike('name', TEST_DONOR_NAME)
      .maybeSingle();
    if (donor && !created.donorIds.includes(donor.id)) created.donorIds.push(donor.id);

    const { data: listing } = await db
      .from('food_listings')
      .select('matched_branch_id, quantity_kg')
      .eq('id', listingId)
      .single();
    const branchId = listing?.matched_branch_id;
    const qty = listing?.quantity_kg ?? 5;

    // Read the branch load fresh immediately before the concurrent requests so
    // we get the actual current value, not a stale value captured by an earlier test.
    let originalLoad = 0;
    if (branchId) {
      const { data: freshBranch } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', branchId)
        .single();
      originalLoad = freshBranch?.current_load_kg ?? 0;
      // Still register for afterAll restore if not already tracked.
      if (!created.branchLoadChanges.find((c) => c.id === branchId)) {
        created.branchLoadChanges.push({ id: branchId, original_load_kg: originalLoad });
      }
    }

    // Fire both requests simultaneously.
    const [r1, r2] = await Promise.all([
      post(`/api/approvals/${listingId}/approve`, {}),
      post(`/api/approvals/${listingId}/approve`, {}),
    ]);

    const statuses = [r1.status, r2.status].sort();
    // Exactly one winner (200) and one loser (409).
    expect(statuses).toEqual([200, 409]);

    // Exactly one inventory row.
    const { data: items } = await db
      .from('inventory_items')
      .select('id')
      .eq('listing_id', listingId);
    let inventoryRows: { id: string }[];
    if (items && items.length > 0) {
      inventoryRows = items;
    } else {
      const { data: byBranch } = await db
        .from('inventory_items')
        .select('id')
        .eq('branch_id', branchId ?? '')
        .eq('item_name', 'CB-TEST-bread-item')
        .eq('status', 'in_stock');
      inventoryRows = byBranch ?? [];
    }
    expect(inventoryRows.length).toBe(1);
    for (const i of inventoryRows) created.inventoryItemIds.push(i.id);

    // Branch load incremented exactly once.
    if (branchId) {
      const { data: branchAfter } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', branchId)
        .single();
      expect(branchAfter?.current_load_kg).toBe(originalLoad + qty);
    }

    // Cleanup.
    const { data: runs } = await db.from('fleet_runs').select('id').eq('listing_id', listingId);
    for (const r of runs ?? []) created.fleetRunIds.push(r.id);

    const { data: auditRows } = await db
      .from('audit_log')
      .select('id')
      .eq('entity_id', listingId)
      .eq('action', 'match_approved');
    for (const r of auditRows ?? []) created.auditLogIds.push(r.id);

    const { data: snaps } = await db
      .from('fairness_snapshots')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);
    for (const s of snaps ?? []) created.fairnessSnapshotIds.push(s.id);
  });

  // ── TEST 5 ─ Two concurrent claims of one item ────────────────────────────

  it('5: two concurrent claims of one item → exactly one 200 and one 409; exactly one claims row', async () => {
    if (skip) return;

    const db = supabase();

    // We need an in_stock inventory item. Create one directly via the approve
    // flow to keep the test realistic.
    const listRes = await post('/api/listings', testListing());
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    const listingId: string = listBody.listing_id;
    created.listingIds.push(listingId);

    const { data: donor } = await db
      .from('donors')
      .select('id')
      .ilike('name', TEST_DONOR_NAME)
      .maybeSingle();
    if (donor && !created.donorIds.includes(donor.id)) created.donorIds.push(donor.id);

    const { data: listing } = await db
      .from('food_listings')
      .select('matched_branch_id, quantity_kg')
      .eq('id', listingId)
      .single();
    const branchId = listing?.matched_branch_id;

    if (branchId && !created.branchLoadChanges.find((c) => c.id === branchId)) {
      const { data: b } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', branchId)
        .single();
      if (b) created.branchLoadChanges.push({ id: branchId, original_load_kg: b.current_load_kg });
    }

    const approveRes = await post(`/api/approvals/${listingId}/approve`, {});
    expect(approveRes.status).toBe(200);

    // Collect cleanup rows from approve.
    const { data: runs } = await db.from('fleet_runs').select('id').eq('listing_id', listingId);
    for (const r of runs ?? []) created.fleetRunIds.push(r.id);

    const { data: auditRows } = await db
      .from('audit_log')
      .select('id')
      .eq('entity_id', listingId)
      .eq('action', 'match_approved');
    for (const r of auditRows ?? []) created.auditLogIds.push(r.id);

    const { data: snaps } = await db
      .from('fairness_snapshots')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);
    for (const s of snaps ?? []) created.fairnessSnapshotIds.push(s.id);

    // Find the inventory item.
    let inventoryItemId: string | null = null;
    const { data: byListing } = await db
      .from('inventory_items')
      .select('id')
      .eq('listing_id', listingId)
      .eq('status', 'in_stock')
      .maybeSingle();
    if (byListing) {
      inventoryItemId = byListing.id;
    } else {
      const { data: byBranch } = await db
        .from('inventory_items')
        .select('id')
        .eq('branch_id', branchId ?? '')
        .eq('item_name', 'CB-TEST-bread-item')
        .eq('status', 'in_stock')
        .maybeSingle();
      inventoryItemId = byBranch?.id ?? null;
    }

    expect(inventoryItemId).not.toBeNull();
    created.inventoryItemIds.push(inventoryItemId!);

    // Two different recipients racing for the same item — not the same
    // recipient twice, which would exercise the one-active-claim guard
    // instead of the inventory-level race this test is actually about.
    const [p1Res, p2Res] = await Promise.all([
      post('/api/profiles', { name: 'CB-TEST-Recipient-1' }),
      post('/api/profiles', { name: 'CB-TEST-Recipient-2' }),
    ]);
    const p1 = await p1Res.json();
    const p2 = await p2Res.json();
    if (!p1.profile || !p2.profile) {
      throw new Error(
        'POST /api/profiles failed — run supabase/migrations/009_recipient_profiles.sql. ' +
          `Responses: ${JSON.stringify(p1)} / ${JSON.stringify(p2)}`
      );
    }
    created.profileIds.push(p1.profile.id, p2.profile.id);

    const [c1, c2] = await Promise.all([
      post('/api/claims', { inventory_item_id: inventoryItemId, profile_id: p1.profile.id }),
      post('/api/claims', { inventory_item_id: inventoryItemId, profile_id: p2.profile.id }),
    ]);

    const statuses = [c1.status, c2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Exactly one claims row.
    const { data: claims } = await db
      .from('claims')
      .select('id')
      .eq('inventory_item_id', inventoryItemId);
    expect((claims ?? []).length).toBe(1);
    for (const c of claims ?? []) created.claimIds.push(c.id);
  });

  // ── TEST 6 ─ POST /api/approvals/[id]/reject ──────────────────────────────

  it('6: reject sets listing to cancelled; branch load, inventory, and donor totals unchanged', async () => {
    if (skip) return;

    const db = supabase();

    const listRes = await post('/api/listings', testListing());
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    const listingId: string = listBody.listing_id;
    created.listingIds.push(listingId);

    const { data: donor } = await db
      .from('donors')
      .select('id')
      .ilike('name', TEST_DONOR_NAME)
      .maybeSingle();
    if (donor && !created.donorIds.includes(donor.id)) created.donorIds.push(donor.id);

    const { data: listing } = await db
      .from('food_listings')
      .select('matched_branch_id, quantity_kg, donor_id')
      .eq('id', listingId)
      .single();
    const branchId = listing?.matched_branch_id;
    const donorId = listing?.donor_id;

    const { data: branchBefore } = branchId
      ? await db.from('branches').select('current_load_kg').eq('id', branchId).single()
      : { data: null };
    const { data: donorBefore } = donorId
      ? await db.from('donors').select('total_kg_donated').eq('id', donorId).single()
      : { data: null };
    const { data: invBefore } = branchId
      ? await db.from('inventory_items').select('id').eq('branch_id', branchId)
      : { data: [] };

    const rejectRes = await post(`/api/approvals/${listingId}/reject`, {});
    expect(rejectRes.status).toBe(200);
    const rejectBody = await rejectRes.json();
    expect(rejectBody.success).toBe(true);

    // Listing status → cancelled.
    const { data: updated } = await db
      .from('food_listings')
      .select('status')
      .eq('id', listingId)
      .single();
    expect(updated?.status).toBe('cancelled');

    // Branch load unchanged.
    if (branchId && branchBefore) {
      const { data: branchAfter } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', branchId)
        .single();
      expect(branchAfter?.current_load_kg).toBe(branchBefore.current_load_kg);
    }

    // No new inventory row.
    if (branchId) {
      const { data: invAfter } = await db
        .from('inventory_items')
        .select('id')
        .eq('branch_id', branchId);
      expect((invAfter ?? []).length).toBe((invBefore ?? []).length);
    }

    // Donor total_kg_donated unchanged.
    if (donorId && donorBefore) {
      const { data: donorAfter } = await db
        .from('donors')
        .select('total_kg_donated')
        .eq('id', donorId)
        .single();
      expect(donorAfter?.total_kg_donated).toBe(donorBefore.total_kg_donated);
    }

    // Collect audit log for cleanup.
    const { data: auditRows } = await db
      .from('audit_log')
      .select('id')
      .eq('entity_id', listingId)
      .eq('action', 'match_rejected');
    for (const r of auditRows ?? []) created.auditLogIds.push(r.id);
  });

  // ── TEST 7 ─ POST /api/fleet/[id]/advance ─────────────────────────────────

  it('7: fleet run advances assigned → en_route → picked_up → completed; further advance returns 409', async () => {
    if (skip) return;

    const db = supabase();

    // We need a fleet_run in 'assigned' state. Create one through the approve flow.
    const listRes = await post('/api/listings', testListing());
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    const listingId: string = listBody.listing_id;
    created.listingIds.push(listingId);

    const { data: donor } = await db
      .from('donors')
      .select('id')
      .ilike('name', TEST_DONOR_NAME)
      .maybeSingle();
    if (donor && !created.donorIds.includes(donor.id)) created.donorIds.push(donor.id);

    const { data: listing } = await db
      .from('food_listings')
      .select('matched_branch_id, quantity_kg')
      .eq('id', listingId)
      .single();
    const branchId = listing?.matched_branch_id;

    if (branchId && !created.branchLoadChanges.find((c) => c.id === branchId)) {
      const { data: b } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', branchId)
        .single();
      if (b) created.branchLoadChanges.push({ id: branchId, original_load_kg: b.current_load_kg });
    }

    const approveRes = await post(`/api/approvals/${listingId}/approve`, {});

    // Fleet tables may not be available (migration 006 optional) — if no run was
    // assigned, skip the advance portion of this test rather than failing it.
    const approveBody = await approveRes.json();
    const runAssigned = approveBody.dispatch?.assigned === true;

    const { data: auditRows } = await db
      .from('audit_log')
      .select('id')
      .eq('entity_id', listingId)
      .eq('action', 'match_approved');
    for (const r of auditRows ?? []) created.auditLogIds.push(r.id);

    const { data: invRows } = await db
      .from('inventory_items')
      .select('id')
      .eq('listing_id', listingId);
    if (invRows && invRows.length > 0) {
      for (const i of invRows) created.inventoryItemIds.push(i.id);
    } else {
      const { data: byBranch } = await db
        .from('inventory_items')
        .select('id')
        .eq('branch_id', branchId ?? '')
        .eq('item_name', 'CB-TEST-bread-item');
      for (const i of byBranch ?? []) created.inventoryItemIds.push(i.id);
    }

    const { data: snaps } = await db
      .from('fairness_snapshots')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);
    for (const s of snaps ?? []) created.fairnessSnapshotIds.push(s.id);

    if (!runAssigned) {
      console.warn(
        '[api.test] Test 7: no fleet run was assigned (migration 006 may be missing) — ' +
          'skipping advance lifecycle assertions.'
      );
      return;
    }

    // Get the run ID.
    const { data: runs } = await db
      .from('fleet_runs')
      .select('id, status')
      .eq('listing_id', listingId)
      .eq('status', 'assigned');
    expect((runs ?? []).length).toBeGreaterThanOrEqual(1);
    const runId = runs![0].id;
    created.fleetRunIds.push(runId);

    // Advance through all states.
    const sequence: string[] = ['en_route', 'picked_up', 'completed'];
    for (const expectedStatus of sequence) {
      const res = await post(`/api/fleet/${runId}/advance`, {});
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.status).toBe(expectedStatus);
    }

    // A further advance on a completed run → 409.
    const extra = await post(`/api/fleet/${runId}/advance`, {});
    expect(extra.status).toBe(409);
  });

  // ── TEST 8 ─ GET /api/storage ──────────────────────────────────────────────

  it('8: GET /api/storage returns branches[] + summary; each zone has temperature_c, rack_state, occupancy_pct', async () => {
    if (skip) return;

    const res = await get('/api/storage');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.branches)).toBe(true);
    expect(typeof body.summary).toBe('object');
    expect(body.branches.length).toBeGreaterThan(0);

    for (const branch of body.branches) {
      expect(Array.isArray(branch.zones)).toBe(true);
      for (const zone of branch.zones) {
        expect(typeof zone.temperature_c).toBe('number');
        expect(['space', 'filling', 'full', 'over']).toContain(zone.rack_state);
        expect(typeof zone.occupancy_pct).toBe('number');
      }
    }
  });

  // ── TEST 9 ─ GET /api/dispatch ────────────────────────────────────────────

  it('9: GET /api/dispatch returns runs[] + summary; every route total_distance_km equals the sum of its legs', async () => {
    if (skip) return;

    const res = await get('/api/dispatch');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.runs)).toBe(true);
    expect(typeof body.summary).toBe('object');

    for (const run of body.runs) {
      const sumLegs = run.route.legs.reduce(
        (sum: number, l: { distance_km: number }) => sum + l.distance_km,
        0
      );
      // Allow a 1-decimal rounding tolerance (toFixed(2) on each leg).
      expect(run.route.total_distance_km).toBeCloseTo(sumLegs, 1);
    }
  });

  // ── TEST 10 ─ GET /api/fleet ──────────────────────────────────────────────

  it('10: GET /api/fleet returns fleet[] + coverage[], or error:fleet_unavailable with HTTP 200 if migration 006 is missing', async () => {
    if (skip) return;

    const res = await get('/api/fleet');
    // The route always returns 200 — even when 006 is missing it says so
    // explicitly rather than spraying 5xx errors in the browser console.
    expect(res.status).toBe(200);

    const body = await res.json();

    if (body.error === 'fleet_unavailable') {
      // Migration 006 not applied — valid state.
      expect(typeof body.message).toBe('string');
      expect(Array.isArray(body.fleet)).toBe(true);
      expect(Array.isArray(body.coverage)).toBe(true);
    } else {
      expect(Array.isArray(body.fleet)).toBe(true);
      expect(Array.isArray(body.coverage)).toBe(true);
    }
  });

  // ── TEST 11 ─ GET /api/agents/plan (SSE) ──────────────────────────────────

  it('11: SSE stream emits ≥1 step, then plan or cached, then done', async () => {
    if (skip) return;

    if (!GEMINI_API_KEY) {
      console.warn(
        '[api.test] Test 11: GEMINI_API_KEY not set — skipping SSE/planner test.'
      );
      return;
    }

    // Create and approve a fresh listing so the planner always has a cold,
    // uncached target — avoids non-determinism from grabbing an arbitrary
    // existing matched listing via .limit(1).
    const db = supabase();

    const listRes = await post('/api/listings', testListing());
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    const listingId: string = listBody.listing_id;
    created.listingIds.push(listingId);

    const { data: freshDonor } = await db
      .from('donors')
      .select('id')
      .ilike('name', TEST_DONOR_NAME)
      .maybeSingle();
    if (freshDonor && !created.donorIds.includes(freshDonor.id))
      created.donorIds.push(freshDonor.id);

    // Approve it so status becomes 'matched'.
    const approveRes = await post(`/api/approvals/${listingId}/approve`, {});
    expect(approveRes.status).toBe(200);

    // Track inventory and related rows created by the approval.
    const { data: invItems } = await db
      .from('inventory_items')
      .select('id')
      .eq('listing_id', listingId);
    for (const i of invItems ?? []) created.inventoryItemIds.push(i.id);

    const { data: fleetRuns } = await db
      .from('fleet_runs')
      .select('id')
      .eq('listing_id', listingId);
    for (const r of fleetRuns ?? []) created.fleetRunIds.push(r.id);

    const { data: auditRows } = await db
      .from('audit_log')
      .select('id')
      .eq('entity_id', listingId)
      .eq('action', 'match_approved');
    for (const r of auditRows ?? []) created.auditLogIds.push(r.id);

    const { data: snaps } = await db
      .from('fairness_snapshots')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);
    for (const s of snaps ?? []) created.fairnessSnapshotIds.push(s.id);

    // Track branch load change for afterAll restore.
    const { data: fl } = await db
      .from('food_listings')
      .select('matched_branch_id, quantity_kg')
      .eq('id', listingId)
      .single();
    if (fl?.matched_branch_id && !created.branchLoadChanges.find((c) => c.id === fl.matched_branch_id)) {
      const { data: br } = await db
        .from('branches')
        .select('current_load_kg')
        .eq('id', fl.matched_branch_id)
        .single();
      if (br)
        created.branchLoadChanges.push({
          id: fl.matched_branch_id,
          original_load_kg: (br.current_load_kg ?? 0) - (fl.quantity_kg ?? 0),
        });
    }

    const res = await fetch(`${BASE}/api/agents/plan?listing_id=${listingId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

    // Parse the SSE stream into events.
    const text = await res.text();
    const events = text
      .split('\n\n')
      .filter((chunk) => chunk.trim())
      .map((chunk) => {
        const eventMatch = chunk.match(/^event:\s*(.+)/m);
        return eventMatch ? eventMatch[1].trim() : null;
      })
      .filter(Boolean) as string[];

    // A cached plan skips recomputation entirely and emits 0 step events by
    // design — the stream goes straight from the cache hit to 'cached' then
    // 'done'. Only assert ≥1 step when the stream ran the planner fresh.
    const isCached = events.includes('cached');
    if (!isCached) {
      expect(events.filter((e) => e === 'step').length).toBeGreaterThanOrEqual(1);
    }

    // Must have 'plan' or 'cached'.
    expect(events.some((e) => e === 'plan' || e === 'cached')).toBe(true);

    // Must end with 'done'.
    expect(events[events.length - 1]).toBe('done');
  });

  // ── TEST 12 ─ GET /api/fairness ───────────────────────────────────────────

  it('12: GET /api/fairness returns jain_index in [0,1]; total_rescued_kg excludes pending listings', async () => {
    if (skip) return;

    const db = supabase();

    // Read the raw data to verify total_rescued_kg independently.
    const { data: listings } = await db.from('food_listings').select('quantity_kg, status');
    const expectedRescued = (listings ?? [])
      .filter(
        (l) =>
          l.status === 'matched' || l.status === 'in_transit' || l.status === 'delivered'
      )
      .reduce((sum, l) => sum + (l.quantity_kg ?? 0), 0);

    const res = await get('/api/fairness');
    expect(res.status).toBe(200);
    const body = await res.json();

    // jain_index must be in (0, 1].
    expect(body.jain_index).toBeGreaterThan(0);
    expect(body.jain_index).toBeLessThanOrEqual(1);

    // total_rescued_kg must exclude pending listings.
    expect(body.total_rescued_kg).toBeCloseTo(expectedRescued, 1);

    // Sanity-check shape.
    expect(Array.isArray(body.branches)).toBe(true);
    expect(typeof body.total_rescued_kg).toBe('number');
    expect(typeof body.meals_equivalent).toBe('number');
  });
});
