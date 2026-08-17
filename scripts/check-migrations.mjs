#!/usr/bin/env node
/**
 * Reports which Supabase migrations are actually applied to the live project.
 *
 * This exists because migration drift here fails *silently*: with
 * 003_escalation.sql un-applied, the near-expiry escalation UPDATE was
 * rejected by a CHECK constraint on every single request, and because that
 * error wasn't inspected the whole feature quietly did nothing for hours.
 * Run this before a demo (or after cloning) so you find out from a checklist
 * rather than from a judge asking why nothing escalates.
 *
 *   node scripts/check-migrations.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Read-only apart from two self-cleaning probes (a status round-trip and a
 * throwaway donor row) that are reverted before exit.
 */

import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const rest = (path, init = {}) => fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: H });

const results = [];
const record = (name, ok, note) => results.push({ name, ok, note });

// --- 001 base schema -------------------------------------------------------
{
  const res = await rest('branches?select=id,capacity_kg&limit=1');
  record('001_schema + seed', res.ok, res.ok ? 'branches table readable' : `HTTP ${res.status}`);
}

// --- 002 approval workflow -------------------------------------------------
{
  const res = await rest('food_listings?select=decision_details,agreed_to_regulations,reviewed_at&limit=1');
  record(
    '002_approval_workflow',
    res.ok,
    res.ok ? 'approval columns present' : 'missing decision_details / agreed_to_regulations / reviewed_at'
  );
}

// --- 003 escalation --------------------------------------------------------
{
  const list = await (await rest('inventory_items?select=id,status&limit=1')).json();
  if (!Array.isArray(list) || list.length === 0) {
    record('003_escalation', false, 'no inventory rows to probe with');
  } else {
    const { id, status } = list[0];
    const probe = await rest(`inventory_items?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'escalated' }),
    });
    const body = probe.ok ? '' : await probe.text();
    const ok = probe.ok || !body.includes('23514');
    record(
      '003_escalation',
      ok,
      ok ? "'escalated' status accepted" : 'CHECK constraint rejects escalated — escalation feature is dead'
    );
    // Always restore the original status.
    await rest(`inventory_items?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }
}

// --- 004 atomic increments -------------------------------------------------
{
  const res = await rest('rpc/increment_branch_load', {
    method: 'POST',
    body: JSON.stringify({ p_branch_id: '00000000-0000-0000-0000-000000000000', p_amount: 0 }),
  });
  const body = res.ok ? '' : await res.text();
  const ok = res.ok || !body.includes('PGRST202');
  record('004_atomic_increments', ok, ok ? 'RPC functions present' : 'missing — every approval will 500');
}

// --- 005 donor name unique index -------------------------------------------
{
  const probe = '__migration_probe__';
  await rest('donors', {
    method: 'POST',
    body: JSON.stringify({ name: probe, type: 'other', lat: 1.3, lng: 103.8 }),
  });
  const dupe = await rest('donors', {
    method: 'POST',
    body: JSON.stringify({ name: probe.toUpperCase(), type: 'other', lat: 1.3, lng: 103.8 }),
  });
  const body = dupe.ok ? '' : await dupe.text();
  const ok = body.includes('23505');
  record(
    '005_donor_name_unique',
    ok,
    ok ? 'case-insensitive unique index active' : 'missing — donor find-or-create race is open'
  );
  // Remove both probes regardless of which inserts succeeded.
  await rest(`donors?name=ilike.${probe}`, { method: 'DELETE' });
  await rest(`donors?name=ilike.${probe.toUpperCase()}`, { method: 'DELETE' });
}

// --- 006 fleet ------------------------------------------------------------
{
  const v = await rest('vehicles?select=id,label&limit=1');
  const r = await rest('fleet_runs?select=id&limit=1');
  if (!v.ok || !r.ok) {
    record('006_fleet', false, 'vehicles / fleet_runs tables missing — fleet pages will be empty');
  } else {
    const rows = await (await rest('vehicles?select=id')).json();
    const n = Array.isArray(rows) ? rows.length : 0;
    record('006_fleet', n > 0, n > 0 ? `${n} vehicles seeded` : 'tables exist but no vehicles seeded');
  }
}

// --- 007 inventory provenance ---------------------------------------------
{
  // The relationship only resolves once inventory_items.listing_id exists.
  const res = await rest('inventory_items?select=listing_id,listing:food_listings(id)&limit=1');
  record(
    '007_inventory_provenance',
    res.ok,
    res.ok
      ? 'inventory linked to originating listing'
      : 'missing — no donor provenance, and public listings can’t show delivery progress'
  );
}

// --- 008 beneficiary_allocations -------------------------------------------
{
  const res = await rest('beneficiary_allocations?select=id&limit=1');
  record(
    '008_beneficiary_allocations',
    res.ok,
    res.ok
      ? 'table present'
      : 'missing — demand-quota allocation is skipped on every approval, falling back to public listing'
  );
}

// --- 009 recipient_profiles -------------------------------------------------
{
  const res = await rest('claims?select=profile_id,pickup_deadline_at&limit=1');
  record(
    '009_recipient_profiles',
    res.ok,
    res.ok
      ? 'profile + pickup-deadline columns present'
      : 'missing — claims stay fully anonymous with no pickup countdown or one-claim-at-a-time limit'
  );
}

// --- 010 recipient_profiles privacy fix -------------------------------------
{
  const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!ANON_KEY) {
    record('010_recipient_profiles_privacy', false, 'no NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to probe with');
  } else {
    const probeName = '__migration_010_probe__';
    const insert = await fetch(`${URL_BASE}/rest/v1/recipient_profiles`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({ name: probeName }),
    });
    const insertBody = insert.ok ? await insert.json() : [];
    const [probeRow] = Array.isArray(insertBody) ? insertBody : [];
    const anonRes = probeRow
      ? await fetch(`${URL_BASE}/rest/v1/recipient_profiles?select=id&id=eq.${probeRow.id}`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        })
      : null;
    const anonRows = anonRes && anonRes.ok ? await anonRes.json() : [];
    const stillPublic = Array.isArray(anonRows) && anonRows.length > 0;
    record(
      '010_recipient_profiles_privacy',
      probeRow ? !stillPublic : false,
      !probeRow
        ? 'could not insert a probe row to test with'
        : stillPublic
          ? 'STILL PUBLIC — anon key can read recipient name/phone, drop the "Public read access" policy'
          : 'recipient_profiles correctly denies anonymous reads'
    );
    if (probeRow) await rest(`recipient_profiles?id=eq.${probeRow.id}`, { method: 'DELETE' });
  }
}

// --- 011 recipient impact --------------------------------------------------
{
  const res = await rest('recipient_profiles?select=total_kg_claimed,donations_completed_count&limit=1');
  record(
    '011_recipient_impact',
    res.ok,
    res.ok
      ? 'impact columns present'
      : 'missing — recipient dashboard has no lifetime totals, and confirming a pickup will fail to delete its inventory row (claims FK still blocks it)'
  );
}

// --- 012 partner dispatch runs ---------------------------------------------
{
  const res = await rest('partner_dispatch_runs?select=id&limit=1');
  record(
    '012_partner_dispatch_runs',
    res.ok,
    res.ok ? 'table present' : 'missing — the daily 6pm dispatch cron has nowhere to write its runs and will fail silently'
  );
}

console.log('\nSupabase migration status\n');
for (const { name, ok, note } of results) {
  console.log(`  ${ok ? '✓' : '✗'}  ${name.padEnd(24)} ${note}`);
}

const missing = results.filter((r) => !r.ok);
if (missing.length === 0) {
  console.log('\nAll migrations applied.\n');
} else {
  console.log(
    `\n${missing.length} migration(s) not applied. Run the matching file(s) from ` +
      `supabase/migrations/ in the Supabase SQL Editor:\n`
  );
  for (const m of missing) console.log(`    supabase/migrations/${m.name}.sql`);
  console.log();
  process.exitCode = 1;
}
