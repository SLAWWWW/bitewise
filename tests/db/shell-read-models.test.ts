/**
 * W2-SHELL read models against the real test database, as lumbung_app under RLS:
 *  - Ringkasan: FLO agreement buckets, agreements needing review (exact links),
 *    renewal tasks due — all relative to the tenant clock, incl. the AC03 month-end
 *    boundary (through 2026-10-31 = valid until 2026-10-31T17:00Z exclusive).
 *  - Parity of the inlined "current agreement" predicate with lumbung.agreement_valid_at_for.
 *  - Pengaturan: activation decisions completed to the 10 PRD §27 keys, policy rows.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { CURRENT_AGREEMENT_CTE, loadDashboard } from '@/src/application/dashboard/queries';
import { listFlos } from '@/src/application/flo/queries';
import { decisionGate, loadSettings, summarizePolicyBody } from '@/src/application/settings/queries';
import { ACTIVATION_DECISION_KEYS } from '@/src/shared/enums';
import { ctxFor, makeTenant, withAppTx, withOwner, type TestTenant } from '../setup/db-helpers';

let t: TestTenant;
let other: TestTenant;
const flo: Record<string, string> = {};
const agr: Record<string, string> = {};

async function addFlo(tenant: TestTenant, code: string) {
  const id = randomUUID();
  await withOwner((c) =>
    c.query(
      `INSERT INTO lumbung.flos (id, tenant_id, code, name, flo_type, service_model, area)
       VALUES ($1, $2, $3, $4, 'PANTI', 'DAILY', 'JAKARTA')`,
      [id, tenant.id, code, `Panti Simulasi ${code}`],
    ),
  );
  return id;
}

/** Agreement from local legal dates (WIB), like the upload command: [from 00:00, through+1 00:00). */
async function addAgreement(tenant: TestTenant, floId: string, from: string, through: string, state: string, version = 1) {
  const id = randomUUID();
  const reviewed = state !== 'PENDING_VERIFICATION';
  await withOwner((c) =>
    c.query(
      `INSERT INTO lumbung.agreements (id, tenant_id, flo_id, version, valid_from_date, valid_through_date,
                                       valid_from, valid_until_exclusive, review_state, reviewer_id, reviewed_at,
                                       revoked_at, revoke_reason)
       VALUES ($1, $2, $3, $4, $5::date, $6::date,
               ($5::date)::timestamp AT TIME ZONE 'Asia/Jakarta', ($6::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta',
               $7, $8, $9, $10, $11)`,
      [
        id,
        tenant.id,
        floId,
        version,
        from,
        through,
        state,
        reviewed ? tenant.users.AGREEMENT_REVIEWER.id : null,
        reviewed ? '2026-01-02T03:00:00Z' : null,
        state === 'REVOKED' ? '2026-10-01T03:00:00Z' : null,
        state === 'REVOKED' ? 'uji' : null,
      ],
    ),
  );
  return id;
}

async function setClock(tenant: TestTenant, iso: string) {
  await withOwner((c) => c.query(`UPDATE lumbung.tenant_clocks SET sim_anchor = $2 WHERE tenant_id = $1`, [tenant.id, iso]));
}

beforeAll(async () => {
  t = await makeTenant(); // clock FROZEN at 2026-10-26T01:00Z (08:00 WIB)
  other = await makeTenant();
  for (const k of ['active', 'monthEnd', 'renewing', 'renewed', 'expired', 'expiredPending', 'pending', 'scheduled', 'revoked', 'none', 'capped']) {
    flo[k] = await addFlo(t, `FLO-${k}`);
  }
  agr.active = await addAgreement(t, flo.active, '2026-01-01', '2027-06-30', 'APPROVED');
  agr.monthEnd = await addAgreement(t, flo.monthEnd, '2026-01-01', '2026-10-31', 'APPROVED'); // AC03 fixture
  agr.renewing = await addAgreement(t, flo.renewing, '2026-01-01', '2026-11-20', 'APPROVED');
  agr.renewingNext = await addAgreement(t, flo.renewing, '2026-11-21', '2027-11-20', 'PENDING_VERIFICATION', 2);
  agr.renewed = await addAgreement(t, flo.renewed, '2026-01-01', '2026-11-05', 'APPROVED');
  agr.renewedNext = await addAgreement(t, flo.renewed, '2026-11-06', '2027-11-05', 'APPROVED', 2);
  agr.expired = await addAgreement(t, flo.expired, '2025-01-01', '2026-09-30', 'APPROVED');
  agr.expiredPending = await addAgreement(t, flo.expiredPending, '2025-01-01', '2026-10-25', 'APPROVED');
  agr.expiredPendingNext = await addAgreement(t, flo.expiredPending, '2026-10-26', '2027-10-25', 'PENDING_VERIFICATION', 2);
  agr.pending = await addAgreement(t, flo.pending, '2026-11-01', '2027-10-31', 'PENDING_VERIFICATION');
  agr.scheduled = await addAgreement(t, flo.scheduled, '2026-12-01', '2027-11-30', 'APPROVED');
  agr.revoked = await addAgreement(t, flo.revoked, '2026-01-01', '2027-01-31', 'REVOKED');
  // A renewal approved early (SUPERSEDE_PREVIOUS, 0015): v1 capped at v2's start 2026-11-15 WIB, in force until then.
  agr.capped = await addAgreement(t, flo.capped, '2026-01-01', '2026-11-30', 'APPROVED');
  agr.cappedNext = await addAgreement(t, flo.capped, '2026-11-15', '2027-11-14', 'APPROVED', 2);
  await withOwner((c) =>
    c.query(
      `UPDATE lumbung.agreements SET superseded_from = '2026-11-14T17:00:00Z', superseded_at = '2026-10-20T03:00:00Z', superseded_by_id = $2
        WHERE id = $1`,
      [agr.capped, agr.cappedNext],
    ),
  );

  await withOwner(async (c) => {
    // due (≤ T) and not-yet-due open tasks; a DONE one must not count.
    await c.query(
      `INSERT INTO lumbung.renewal_tasks (tenant_id, agreement_id, offset_days, due_at, status) VALUES
         ($1, $2, 30, '2026-09-30T17:00:00Z', 'OPEN'),
         ($1, $2, 14, '2026-10-16T17:00:00Z', 'OPEN'),
         ($1, $2, 7,  '2026-10-23T17:00:00Z', 'DONE'),
         ($1, $3, 30, '2026-10-20T17:00:00Z', 'OPEN'),
         ($1, $3, 14, '2026-11-05T17:00:00Z', 'OPEN')`,
      [t.id, agr.monthEnd, agr.renewing],
    );
    await c.query(`INSERT INTO lumbung.activation_decisions (tenant_id, key) SELECT $1, k FROM unnest($2::text[]) k`, [
      t.id,
      ACTIVATION_DECISION_KEYS.slice(0, 9),
    ]);
    await c.query(
      `INSERT INTO lumbung.policy_versions (tenant_id, kind, code, version, body, status, approved_by, approved_at) VALUES
         ($1, 'SAFETY', 'SAFETY-DEMO-SYNTH-1.0', '1.0', '{"min_handling_hours":2}', 'APPROVED_DEMO', $2, '2026-10-01T03:00:00Z'),
         ($1, 'ALLOCATION', 'ALLOC-DEMO-2.0', '2.0', '{"weights":{"need":0.25,"coverage":0.35}}', 'APPROVED_DEMO', $2, '2026-10-01T03:00:00Z'),
         ($1, 'ALLOCATION', 'ALLOC-DRAFT-3.0', '3.0', '{}', 'DRAFT', NULL, NULL)`,
      [t.id, t.users.ADMIN.id],
    );
    await c.query(
      `INSERT INTO lumbung.tenant_active_policies (tenant_id, kind, policy_version_id)
       SELECT $1, 'ALLOCATION', id FROM lumbung.policy_versions WHERE tenant_id = $1 AND code = 'ALLOC-DEMO-2.0'`,
      [t.id],
    );
  });
  // Noise in another tenant must never show up.
  const f = await addFlo(other, 'FLO-other');
  await addAgreement(other, f, '2026-11-01', '2027-10-31', 'PENDING_VERIFICATION');
});

describe('Ringkasan read model', () => {
  it('buckets every FLO by agreement status at the tenant clock (seed classifier semantics)', async () => {
    const d = await withAppTx(ctxFor(t, 'AUDITOR'), (c) => loadDashboard(c));
    expect(d.now).toBe('2026-10-26T01:00:00.000Z');
    expect(d.clockMode).toBe('FROZEN');
    expect(d.flo.total).toBe(11);
    expect(d.flo.byBucket).toEqual({
      ACTIVE: 2, // active, capped (in force until its approved successor starts — no gap, not "expiring")
      EXPIRING: 3, // monthEnd, renewing, renewed (renewed still ends ≤ 30d; it only leaves the review list)
      SCHEDULED: 1,
      EXPIRED: 2, // expired, expiredPending
      REVOKED: 1, // revoked (the directory says REVOKED too)
      PENDING: 1,
      NONE: 1, // none
    });
  });

  it('uses exactly the FLO directory status for every FLO (one derivation for both screens)', async () => {
    for (const at of ['2026-10-26T01:00:00Z', '2026-10-31T17:00:00Z', '2026-11-14T17:00:00Z', '2026-12-01T00:00:00Z']) {
      await setClock(t, at);
      try {
        const d = await withAppTx(ctxFor(t, 'AUDITOR'), (c) => loadDashboard(c));
        const list = await withAppTx(ctxFor(t, 'AUDITOR'), (c) => listFlos(c, {}, { limit: 200 }));
        const fromDirectory: Record<string, number> = {};
        for (const i of list.items) {
          const b = i.agreement.status === 'EXPIRING_SOON' ? 'EXPIRING' : i.agreement.status;
          fromDirectory[b] = (fromDirectory[b] ?? 0) + 1;
        }
        const nonZero = Object.fromEntries(Object.entries(d.flo.byBucket).filter(([, n]) => n > 0));
        expect(nonZero, at).toEqual(fromDirectory);
      } finally {
        await setClock(t, '2026-10-26T01:00:00Z');
      }
    }
  });

  it('lists agreements needing review with exact links, revoked then pending first, and excludes already-renewed ones', async () => {
    const d = await withAppTx(ctxFor(t, 'COORDINATOR'), (c) => loadDashboard(c));
    expect(d.review.revokedTotal).toBe(1);
    expect(d.review.pendingTotal).toBe(3);
    expect(d.review.expiringTotal).toBe(2);
    const byId = new Map(d.review.items.map((i) => [i.agreement_id, i]));
    expect(d.review.items[0]).toMatchObject({ kind: 'REVOKED', agreement_id: agr.revoked, flo_id: flo.revoked });
    expect(d.review.items.slice(1, 4).every((i) => i.kind === 'PENDING')).toBe(true);
    expect(new Set(d.review.items.slice(1, 4).map((i) => i.agreement_id))).toEqual(
      new Set([agr.pending, agr.expiredPendingNext, agr.renewingNext]),
    );
    expect(d.review.items.slice(4).map((i) => i.agreement_id)).toEqual([agr.monthEnd, agr.renewing]);
    expect(byId.has(agr.capped)).toBe(false); // renewed early: nothing left to review
    expect(byId.get(agr.renewing)!.renewal_state).toBe('PENDING');
    expect(byId.get(agr.monthEnd)!.renewal_state).toBe('NONE');
    expect(byId.has(agr.renewed)).toBe(false); // approved successor exists
    for (const i of d.review.items) expect(i.href).toBe(`/flo/${i.flo_id}/perjanjian`);
    expect(byId.get(agr.monthEnd)!.valid_until_exclusive).toBe('2026-10-31T17:00:00.000Z');
  });

  it('respects the review limit while keeping exact totals', async () => {
    const d = await withAppTx(ctxFor(t), (c) => loadDashboard(c, { reviewLimit: 2, renewalLimit: 1 }));
    expect(d.review.items).toHaveLength(2);
    expect(d.review.pendingTotal + d.review.expiringTotal).toBe(5);
    expect(d.renewals.items).toHaveLength(1);
    expect(d.renewals.dueTotal).toBe(3);
  });

  it('counts renewal tasks due at the tenant clock (OPEN only), linking to the FLO agreement page', async () => {
    const d = await withAppTx(ctxFor(t), (c) => loadDashboard(c));
    expect(d.renewals.dueTotal).toBe(3);
    expect(d.renewals.upcomingTotal).toBe(1);
    expect(d.renewals.items.map((r) => [r.flo_id, r.offset_days])).toEqual([
      [flo.monthEnd, 30],
      [flo.monthEnd, 14],
      [flo.renewing, 30],
    ]);
    expect(d.renewals.items.every((r) => r.href === `/flo/${r.flo_id}/perjanjian`)).toBe(true);
  });

  it('AC03 month end: through 2026-10-31 is EXPIRING 1 µs before 2026-10-31T17:00Z and EXPIRED at it', async () => {
    try {
      await setClock(t, '2026-10-31T16:59:59.999999Z');
      const before = await withAppTx(ctxFor(t), (c) => loadDashboard(c));
      expect(before.flo.byBucket.EXPIRING).toBe(3);
      await setClock(t, '2026-10-31T17:00:00Z');
      const at = await withAppTx(ctxFor(t), (c) => loadDashboard(c));
      expect(at.flo.byBucket.EXPIRED).toBe(3); // expired, expiredPending, monthEnd
      expect(at.review.items.some((i) => i.agreement_id === agr.monthEnd)).toBe(false);
    } finally {
      await setClock(t, '2026-10-26T01:00:00Z');
    }
  });

  it('the inlined current-agreement predicate equals lumbung.agreement_valid_at_for for every FLO and several instants', async () => {
    for (const at of ['2026-10-26T01:00:00Z', '2026-10-31T16:59:59.999Z', '2026-10-31T17:00:00Z', '2026-11-05T17:00:00Z', '2026-11-14T16:59:59.999Z', '2026-11-14T17:00:00Z', '2026-12-01T00:00:00Z']) {
      const app = await withAppTx(ctxFor(t), (c) =>
        c.query<{ flo_id: string; cur_id: string | null }>(`WITH ${CURRENT_AGREEMENT_CTE} SELECT flo_id, cur_id FROM cur ORDER BY flo_id`, [at]),
      );
      const owner = await withOwner((c) =>
        c.query<{ flo_id: string; cur_id: string | null }>(
          `SELECT f.id AS flo_id, lumbung.agreement_valid_at_for($1, f.id, $2::timestamptz) AS cur_id
             FROM lumbung.flos f WHERE f.tenant_id = $1 ORDER BY f.id`,
          [t.id, at],
        ),
      );
      expect(app.rows).toEqual(owner.rows);
    }
  });

  it('shows nothing of another tenant and nothing without context', async () => {
    const d = await withAppTx(ctxFor(other), (c) => loadDashboard(c));
    expect(d.flo.total).toBe(1);
    expect(d.review.pendingTotal).toBe(1);
    await expect(
      withAppTx({ tenantId: null, actorKind: 'USER', userId: null, correlationId: randomUUID() }, (c) => loadDashboard(c)),
    ).rejects.toMatchObject({ code: 'CONTEXT_REQUIRED' });
  });
});

describe('Pengaturan read model', () => {
  it('completes the readiness checklist to all 10 PRD §27 decisions with live gating reasons', async () => {
    const s = await withAppTx(ctxFor(t, 'AUDITOR'), (c) => loadSettings(c, 'TEST'));
    expect(s.decisions.map((d) => d.key)).toEqual([...ACTIVATION_DECISION_KEYS]);
    expect(s.decisions.slice(0, 9).every((d) => d.status === 'NOT_DECIDED' && d.disabled_reason === 'NOT_DECIDED')).toBe(true);
    expect(s.decisions[9]).toMatchObject({ key: 'HOSTING_OPERATIONS', status: 'MISSING', live_enabled: false, disabled_reason: 'MISSING' });
    expect(s.approvedDecisionCount).toBe(0);
    expect(s.now).toBe('2026-10-26T01:00:00.000Z');
  });

  it('lists policy versions by kind with active flag and APPROVED_LIVE-only live use', async () => {
    const s = await withAppTx(ctxFor(t), (c) => loadSettings(c, 'TEST'));
    expect(s.policies.map((p) => p.code)).toEqual(['ALLOC-DEMO-2.0', 'ALLOC-DRAFT-3.0', 'SAFETY-DEMO-SYNTH-1.0']);
    const alloc = s.policies[0];
    expect(alloc).toMatchObject({ kind: 'ALLOCATION', status: 'APPROVED_DEMO', is_active: true, live_allowed: false });
    expect(alloc.approved_by_name).toBe(t.users.ADMIN.displayName);
    expect(alloc.approved_at).toBe('2026-10-01T03:00:00.000Z');
    expect(s.policies[1]).toMatchObject({ is_active: false, approved_at: null });
  });

  it('gates live capabilities: approved AND LIVE tenant only', () => {
    expect(decisionGate('APPROVED', 'LIVE')).toEqual({ live_enabled: true, disabled_reason: null });
    expect(decisionGate('APPROVED', 'DEMO')).toEqual({ live_enabled: false, disabled_reason: 'TENANT_NOT_LIVE' });
    expect(decisionGate('NOT_DECIDED', 'LIVE')).toEqual({ live_enabled: false, disabled_reason: 'NOT_DECIDED' });
    expect(decisionGate('MISSING', 'LIVE')).toEqual({ live_enabled: false, disabled_reason: 'MISSING' });
  });

  it('summarises policy bodies: weights first, scalar fields sorted, nested objects counted as hidden', () => {
    const s = summarizePolicyBody({ weights: { need: 0.25, coverage: 0.35 }, horizon_days: 30, nested: { a: 1 }, rule: 'X' });
    expect(s.weights).toEqual([
      { key: 'coverage', value: '0.35' },
      { key: 'need', value: '0.25' },
    ]);
    expect(s.fields).toEqual([
      { key: 'horizon_days', value: '30' },
      { key: 'rule', value: 'X' },
    ]);
    expect(s.hidden).toBe(1);
    expect(summarizePolicyBody({}).empty).toBe(true);
    expect(summarizePolicyBody(null).empty).toBe(true);
    expect(summarizePolicyBody('x').fields).toEqual([{ key: 'value', value: 'x' }]);
  });
});
