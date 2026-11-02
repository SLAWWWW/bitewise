/**
 * W2-FLO: agreement and need commands against the real embedded Postgres
 * (db/migrations/0013_agreement_commands.sql), as lumbung_app with RLS.
 *
 *  AC03  SQL agreement_valid_at parity: valid at end − 1 ms, invalid exactly at the
 *        exclusive end (local month end 2026-10-31 WIB → 2026-10-31T17:00Z).
 *  AC04  a pending renewal upload leaves the FLO without a valid agreement after the
 *        old expiry until a reviewer approves it.
 *  Overlap requires the explicit SUPERSEDE_PREVIOUS resolution; non-reviewers get
 *  LB:FORBIDDEN; idempotent replay returns the stored response; a different payload
 *  under the same key → IDEMPOTENCY_PAYLOAD_MISMATCH; audit rows are written.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '@/src/db/errors';
import { endOfLocalDayExclusive, startOfLocalDay } from '@/src/lib/tz';
import { approveAgreement, revokeAgreement, uploadAgreement } from '@/src/application/agreements/commands';
import { submitNeed } from '@/src/application/flo/commands';
import { listFlos } from '@/src/application/flo/queries';
import { ctxFor, makeTenant, ownerPool, withAppTx, withOwner, type TestTenant } from '../setup/db-helpers';
import { buildFloFixture, setClock, T_ISO, type FloFixture } from './agreement-fixtures';

let fx: FloFixture;
let other: TestTenant;
let t: TestTenant;

beforeAll(async () => {
  t = await makeTenant(ownerPool(), { mode: 'TEST' });
  fx = await buildFloFixture(ownerPool(), t);
  other = await makeTenant(ownerPool(), { mode: 'TEST' });
});

afterAll(async () => {
  for (const id of [t?.id, other?.id].filter(Boolean)) {
    await withOwner(async (c) => {
      await c.query(`SELECT set_config('lumbung.reset_tenant', $1, true)`, [id]);
      await c.query('DELETE FROM lumbung.tenants WHERE id = $1', [id]);
    }).catch(() => undefined);
  }
});

const reviewer = () => ctxFor(t, 'AGREEMENT_REVIEWER');
const key = () => `test-${randomUUID()}`;
const hash = (s: string) => s.padEnd(64, '0').slice(0, 64);

async function validAt(floId: string, instant: string): Promise<string | null> {
  return withAppTx(reviewer(), async (c) =>
    (await c.query<{ a: string | null }>(`SELECT lumbung.agreement_valid_at($1, $2::timestamptz) AS a`, [floId, instant])).rows[0].a,
  );
}

async function expectDomainError(p: Promise<unknown>, code: string, http?: number): Promise<DomainError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    const err = e as DomainError;
    expect(err.code).toBe(code);
    if (http !== undefined) expect(err.http).toBe(http);
    return err;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

describe('AC03 — exclusive end at the local month end', () => {
  it('derives [from 00:00 WIB, through+1 00:00 WIB) and agrees with src/lib/tz', async () => {
    const row = await withAppTx(reviewer(), async (c) =>
      (
        await c.query(`SELECT valid_from, valid_until_exclusive, valid_through_date FROM lumbung.agreements WHERE id = $1`, [
          fx.agreement.F2,
        ])
      ).rows[0],
    );
    expect(row.valid_through_date).toBe('2026-10-31');
    expect((row.valid_until_exclusive as Date).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect((row.valid_until_exclusive as Date).toISOString()).toBe(endOfLocalDayExclusive('2026-10-31', 'Asia/Jakarta').toISOString());
    expect((row.valid_from as Date).toISOString()).toBe(startOfLocalDay('2025-11-01', 'Asia/Jakarta').toISOString());
  });

  it('agreement_valid_at is true at end − 1 ms and false exactly at the end', async () => {
    expect(await validAt(fx.flo.F2, '2026-10-31T16:59:59.999Z')).toBe(fx.agreement.F2);
    expect(await validAt(fx.flo.F2, '2026-10-31T17:00:00.000Z')).toBeNull();
    expect(await validAt(fx.flo.F2, '2025-10-31T16:59:59.999Z')).toBeNull(); // before the start
    expect(await validAt(fx.flo.F2, '2025-10-31T17:00:00.000Z')).toBe(fx.agreement.F2); // start inclusive
  });

  it('upload_agreement converts legal dates in the tenant time zone (no interval mismatch)', async () => {
    const res = await withAppTx(reviewer(), (c) =>
      uploadAgreement(
        c,
        { flo_id: fx.flo.F5, valid_from_date: '2026-10-01', document_end_date: '2026-10-31', end_date_interpretation: 'THROUGH_INCLUSIVE', signed_date: '2026-09-28' },
        { idempotencyKey: key(), requestHash: hash('a1') },
      ),
    );
    expect(res.agreement.review_state).toBe('PENDING_VERIFICATION');
    expect(res.agreement.version).toBe(1);
    expect(new Date(res.agreement.valid_from).toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(new Date(res.agreement.valid_until_exclusive).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    // Pending is never valid.
    expect(await validAt(fx.flo.F5, '2026-10-15T00:00:00Z')).toBeNull();

    const approved = await withAppTx(reviewer(), (c) =>
      approveAgreement(c, res.agreement.id, { expected_revision: 1 }, { idempotencyKey: key(), requestHash: hash('a2') }),
    );
    expect(approved.agreement.status).toBe('ACTIVE');
    expect(approved.agreement.expiring_soon).toBe(true);
    expect(await validAt(fx.flo.F5, '2026-10-31T16:59:59.999Z')).toBe(res.agreement.id);
    expect(await validAt(fx.flo.F5, '2026-10-31T17:00:00.000Z')).toBeNull();

    const inv = await withOwner(async (c) =>
      (await c.query(`SELECT code FROM lumbung.verify_tenant_invariants($1) WHERE code LIKE 'AGREEMENT%'`, [t.id])).rows,
    );
    expect(inv).toEqual([]);
  });

  it('rejects an interval whose end precedes its start', async () => {
    await expectDomainError(
      withAppTx(reviewer(), (c) =>
        c.query(`SELECT lumbung.upload_agreement($1, NULL, NULL, '2026-12-01', '2026-11-30', 'THROUGH_INCLUSIVE', NULL, $2, $3)`, [fx.flo.F5, key(), hash('bad')]),
      ),
      'AGREEMENT_INVALID_INTERVAL',
      400,
    );
  });
});

describe('AC04 — a pending renewal is not valid after the old expiry until approved', () => {
  let t4: TestTenant;
  let f4: FloFixture;
  beforeAll(async () => {
    t4 = await makeTenant(ownerPool(), { mode: 'TEST' });
    f4 = await buildFloFixture(ownerPool(), t4);
  });
  afterAll(async () => {
    await withOwner(async (c) => {
      await c.query(`SELECT set_config('lumbung.reset_tenant', $1, true)`, [t4.id]);
      await c.query('DELETE FROM lumbung.tenants WHERE id = $1', [t4.id]);
    }).catch(() => undefined);
  });

  it('stays without a valid agreement after expiry, then becomes ACTIVE on approval', async () => {
    const rev = ctxFor(t4, 'AGREEMENT_REVIEWER');
    const firstDayWib = '2026-10-31T17:00:00.000Z'; // 2026-11-01 00:00 WIB
    const valid = (instant: string) =>
      withAppTx(rev, async (c) =>
        (await c.query(`SELECT lumbung.agreement_valid_at($1, $2::timestamptz) AS a`, [f4.flo.F3, instant])).rows[0].a,
      );

    expect(await valid('2026-10-31T16:59:59.999Z')).toBe(f4.agreement.F3_OLD);
    expect(await valid(firstDayWib)).toBeNull();

    // Move the tenant clock past the old expiry: the directory says EXPIRED with a pending version.
    await setClock(ownerPool(), t4.id, '2026-11-02T01:00:00.000Z');
    const before = await withAppTx(ctxFor(t4, 'AUDITOR'), (c) => listFlos(c, { ids: [f4.flo.F3] }));
    expect(before.items[0].agreement.status).toBe('EXPIRED');
    expect(before.items[0].agreement.has_pending_version).toBe(true);
    expect(await valid('2026-11-02T01:00:00.000Z')).toBeNull();

    const res = await withAppTx(rev, (c) =>
      approveAgreement(c, f4.agreement.F3_RENEWAL, { expected_revision: 1 }, { idempotencyKey: key(), requestHash: hash('r1') }),
    );
    expect(res.superseded_agreement_ids).toEqual([]); // adjacent, not overlapping
    expect(res.renewal_tasks_closed).toBe(1);
    expect(await valid(firstDayWib)).toBe(f4.agreement.F3_RENEWAL);
    expect(await valid('2026-11-02T01:00:00.000Z')).toBe(f4.agreement.F3_RENEWAL);

    const after = await withAppTx(ctxFor(t4, 'AUDITOR'), (c) => listFlos(c, { ids: [f4.flo.F3] }));
    expect(after.items[0].agreement.status).toBe('ACTIVE');
    expect(after.items[0].agreement.valid_through_date).toBe('2027-10-31');

    const task = await withOwner(async (c) =>
      (await c.query(`SELECT status, submitted_agreement_id FROM lumbung.renewal_tasks WHERE id = $1`, [f4.renewalTaskF3])).rows[0],
    );
    expect(task).toEqual({ status: 'DONE', submitted_agreement_id: f4.agreement.F3_RENEWAL });
    await setClock(ownerPool(), t4.id, T_ISO);
  });

  it('upload links the open renewal task of the previous version', async () => {
    const t5 = await makeTenant(ownerPool(), { mode: 'TEST' });
    const f5 = await buildFloFixture(ownerPool(), t5);
    const res = await withAppTx(ctxFor(t5, 'AGREEMENT_REVIEWER'), (c) =>
      uploadAgreement(
        c,
        { flo_id: f5.flo.F3, valid_from_date: '2026-11-01', document_end_date: '2028-10-31', end_date_interpretation: 'THROUGH_INCLUSIVE' },
        { idempotencyKey: key(), requestHash: hash('u5') },
      ),
    );
    expect(res.agreement.version).toBe(3);
    expect(res.linked_renewal_tasks).toBe(1);
    await withOwner(async (c) => {
      await c.query(`SELECT set_config('lumbung.reset_tenant', $1, true)`, [t5.id]);
      await c.query('DELETE FROM lumbung.tenants WHERE id = $1', [t5.id]);
    });
  });
});

describe('approve_agreement', () => {
  it('requires an explicit resolution for an overlapping approved interval', async () => {
    const up = await withAppTx(reviewer(), (c) =>
      uploadAgreement(
        c,
        { flo_id: fx.flo.F2, valid_from_date: '2026-10-15', document_end_date: '2027-10-14', end_date_interpretation: 'THROUGH_INCLUSIVE' },
        { idempotencyKey: key(), requestHash: hash('o1') },
      ),
    );
    const err = await expectDomainError(
      withAppTx(reviewer(), (c) =>
        approveAgreement(c, up.agreement.id, { expected_revision: 1 }, { idempotencyKey: key(), requestHash: hash('o2') }),
      ),
      'AGREEMENT_OVERLAP_UNRESOLVED',
      409,
    );
    expect(err.detail?.overlapping_agreement_ids).toEqual([fx.agreement.F2]);
    // Nothing changed.
    expect(await validAt(fx.flo.F2, '2026-10-26T01:00:00Z')).toBe(fx.agreement.F2);

    const ok = await withAppTx(reviewer(), (c) =>
      approveAgreement(
        c,
        up.agreement.id,
        { expected_revision: 1, overlap_resolution: 'SUPERSEDE_PREVIOUS' },
        { idempotencyKey: key(), requestHash: hash('o3') },
      ),
    );
    expect(ok.superseded_agreement_ids).toEqual([fx.agreement.F2]);
    // F2 started earlier: it is capped at the successor's start (2026-10-15 WIB), not erased.
    expect(ok.truncated_agreement_ids).toEqual([fx.agreement.F2]);
    expect(ok.replaced_agreement_ids).toEqual([]);
    expect(ok.agreement.supersedes_id).toBe(fx.agreement.F2);
    expect(ok.renewal_tasks_created).toBe(3);
    const states = await withAppTx(reviewer(), async (c) =>
      (
        await c.query(
          `SELECT a.id, a.review_state, a.revision, a.superseded_from, a.superseded_by_id, a.valid_through_date,
                  lumbung.agreement_status(a, lumbung.tenant_now()) AS status
             FROM lumbung.agreements a WHERE a.flo_id = $1 ORDER BY a.version`,
          [fx.flo.F2],
        )
      ).rows,
    );
    expect(states).toEqual([
      {
        id: fx.agreement.F2, review_state: 'APPROVED', revision: 2, superseded_from: new Date('2026-10-14T17:00:00.000Z'),
        superseded_by_id: up.agreement.id, valid_through_date: '2026-10-31', status: 'SUPERSEDED',
      },
      { id: up.agreement.id, review_state: 'APPROVED', revision: 2, superseded_from: null, superseded_by_id: null, valid_through_date: '2027-10-14', status: 'ACTIVE' },
    ]);
    // History before the successor's start is still covered by F2; afterwards by the successor.
    expect(await validAt(fx.flo.F2, '2026-10-14T16:59:59.999Z')).toBe(fx.agreement.F2);
    expect(await validAt(fx.flo.F2, '2026-10-14T17:00:00.000Z')).toBe(up.agreement.id);
    expect(await validAt(fx.flo.F2, '2026-10-26T01:00:00Z')).toBe(up.agreement.id);
    const overlaps = await withOwner(async (c) =>
      (await c.query(`SELECT code FROM lumbung.verify_tenant_invariants($1) WHERE code = 'AGREEMENT_OVERLAP'`, [t.id])).rows,
    );
    expect(overlaps).toEqual([]);
  });

  it('refuses a non-reviewer with LB:FORBIDDEN (403) and changes nothing', async () => {
    for (const role of ['COORDINATOR', 'AUDITOR', 'ADMIN'] as const) {
      await expectDomainError(
        withAppTx(ctxFor(t, role), (c) =>
          approveAgreement(c, fx.agreement.F4_PENDING, { expected_revision: 1 }, { idempotencyKey: key(), requestHash: hash('f') }),
        ),
        'FORBIDDEN',
        403,
      );
    }
    // Worker/agent actor kinds never get agreement.review either.
    await expectDomainError(
      withAppTx(ctxFor(t, { kind: 'AGENT' }), (c) =>
        approveAgreement(c, fx.agreement.F4_PENDING, { expected_revision: 1 }, { idempotencyKey: key(), requestHash: hash('f') }),
      ),
      'FORBIDDEN',
      403,
    );
    const state = await withAppTx(reviewer(), async (c) =>
      (await c.query(`SELECT review_state FROM lumbung.agreements WHERE id = $1`, [fx.agreement.F4_PENDING])).rows[0].review_state,
    );
    expect(state).toBe('PENDING_VERIFICATION');
  });

  it('replays the stored response for the same key, writes one audit row, and rejects a different payload', async () => {
    const k = key();
    const first = await withAppTx(reviewer(), (c) =>
      approveAgreement(c, fx.agreement.F4_PENDING, { expected_revision: 1 }, { idempotencyKey: k, requestHash: hash('i1') }),
    );
    expect(first.agreement.review_state).toBe('APPROVED');
    expect(first.agreement.revision).toBe(2);

    // Same key + same hash (even though expected_revision is now stale) → identical response, no new effects.
    const replay = await withAppTx(reviewer(), (c) =>
      approveAgreement(c, fx.agreement.F4_PENDING, { expected_revision: 1 }, { idempotencyKey: k, requestHash: hash('i1') }),
    );
    expect(replay).toEqual(first);

    await expectDomainError(
      withAppTx(reviewer(), (c) =>
        approveAgreement(c, fx.agreement.F4_PENDING, { expected_revision: 2 }, { idempotencyKey: k, requestHash: hash('i2') }),
      ),
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
      409,
    );

    const ctx = { ...reviewer(), correlationId: `corr-${randomUUID()}` };
    const audits = await withOwner(async (c) =>
      (
        await c.query(
          `SELECT action, actor_id, actor_kind, subject_type, subject_revision, occurred_at, payload
             FROM lumbung.audit_events WHERE tenant_id = $1 AND subject_id = $2 ORDER BY created_at`,
          [t.id, fx.agreement.F4_PENDING],
        )
      ).rows,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'AGREEMENT_APPROVED',
      actor_id: t.users.AGREEMENT_REVIEWER.id,
      actor_kind: 'USER',
      subject_type: 'AGREEMENT',
      subject_revision: 2,
    });
    expect((audits[0].occurred_at as Date).toISOString()).toBe(T_ISO); // tenant clock, not wall clock
    void ctx;
  });

  it('records the correlation id and is revision-guarded', async () => {
    const up = await withAppTx(reviewer(), (c) =>
      uploadAgreement(
        c,
        { flo_id: fx.flo.F6, valid_from_date: '2026-11-01', document_end_date: '2027-10-31', end_date_interpretation: 'THROUGH_INCLUSIVE' },
        { idempotencyKey: key(), requestHash: hash('c1') },
      ),
    );
    await expectDomainError(
      withAppTx(reviewer(), (c) =>
        approveAgreement(c, up.agreement.id, { expected_revision: 7 }, { idempotencyKey: key(), requestHash: hash('c2') }),
      ),
      'REVISION_CONFLICT',
      409,
    );
    const corr = `corr-${randomUUID()}`;
    await withAppTx({ ...reviewer(), correlationId: corr }, (c) =>
      approveAgreement(c, up.agreement.id, { expected_revision: 1 }, { idempotencyKey: key(), requestHash: hash('c3') }),
    );
    const row = await withOwner(async (c) =>
      (
        await c.query(`SELECT correlation_id FROM lumbung.audit_events WHERE subject_id = $1 AND action = 'AGREEMENT_APPROVED'`, [
          up.agreement.id,
        ])
      ).rows[0],
    );
    expect(row.correlation_id).toBe(corr);
    // Approving twice is an invalid transition, not a silent success.
    await expectDomainError(
      withAppTx(reviewer(), (c) =>
        approveAgreement(c, up.agreement.id, { expected_revision: 2 }, { idempotencyKey: key(), requestHash: hash('c4') }),
      ),
      'INVALID_STATE',
      409,
    );
  });

  it('hides another tenant’s agreement (NOT_FOUND) even from that tenant’s reviewer role', async () => {
    await expectDomainError(
      withAppTx(ctxFor(other, 'AGREEMENT_REVIEWER'), (c) =>
        approveAgreement(c, fx.agreement.F4_PENDING, { expected_revision: 2 }, { idempotencyKey: key(), requestHash: hash('x') }),
      ),
      'NOT_FOUND',
      404,
    );
    await expectDomainError(
      withAppTx(ctxFor(other, 'AGREEMENT_REVIEWER'), (c) =>
        uploadAgreement(
          c,
          { flo_id: fx.flo.F1, valid_from_date: '2026-11-01', document_end_date: '2027-10-31', end_date_interpretation: 'THROUGH_INCLUSIVE' },
          { idempotencyKey: key(), requestHash: hash('x2') },
        ),
      ),
      'NOT_FOUND',
      404,
    );
  });

  it('cannot be bypassed with a direct table write', async () => {
    const e = await withAppTx(reviewer(), (c) =>
      c.query(`UPDATE lumbung.agreements SET review_state = 'APPROVED' WHERE id = $1`, [fx.agreement.F3_RENEWAL]),
    ).catch((x) => x);
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).pgCode).toBe('42501');
  });
});

describe('revoke_agreement', () => {
  it('revokes with a reason: REVOKED, task, renewal tasks cancelled, no longer valid', async () => {
    const before = await withAppTx(reviewer(), async (c) =>
      (await c.query(`SELECT revision FROM lumbung.agreements WHERE id = $1`, [fx.agreement.F1])).rows[0].revision as number,
    );
    await expectDomainError(
      withAppTx(reviewer(), (c) =>
        c.query(`SELECT lumbung.revoke_agreement($1, $2, '  ', $3, $4)`, [fx.agreement.F1, before, key(), hash('rv0')]),
      ),
      'VALIDATION_FAILED',
      400,
    );
    await expectDomainError(
      withAppTx(ctxFor(t, 'COORDINATOR'), (c) =>
        revokeAgreement(c, fx.agreement.F1, { expected_revision: before, reason: 'Tidak sah' }, { idempotencyKey: key(), requestHash: hash('rv1') }),
      ),
      'FORBIDDEN',
      403,
    );
    const res = await withAppTx(reviewer(), (c) =>
      revokeAgreement(
        c,
        fx.agreement.F1,
        { expected_revision: before, reason: 'Dokumen tidak sah' },
        { idempotencyKey: key(), requestHash: hash('rv2') },
      ),
    );
    expect(res.agreement.review_state).toBe('REVOKED');
    expect(res.agreement.status).toBe('REVOKED');
    expect(new Date(res.agreement.revoked_at!).toISOString()).toBe(T_ISO);
    expect(res.commitments).toMatchObject({ affected_allocations: 0 });
    expect(res.task_id).toBeTruthy();
    expect(await validAt(fx.flo.F1, T_ISO)).toBeNull();

    const task = await withAppTx(ctxFor(t, 'COORDINATOR'), async (c) =>
      (await c.query(`SELECT kind, subject_id, severity, state, payload FROM lumbung.tasks WHERE id = $1`, [res.task_id])).rows[0],
    );
    expect(task).toMatchObject({ kind: 'AGREEMENT_REVOKED', subject_id: fx.agreement.F1, severity: 'HIGH', state: 'OPEN' });
    expect(task.payload).toMatchObject({ flo_id: fx.flo.F1, reason: 'Dokumen tidak sah' });

    const list = await withAppTx(ctxFor(t, 'AUDITOR'), (c) => listFlos(c, { ids: [fx.flo.F1] }));
    expect(list.items[0].agreement.status).toBe('REVOKED');

    // Only APPROVED agreements can be revoked.
    await expectDomainError(
      withAppTx(reviewer(), (c) =>
        revokeAgreement(c, fx.agreement.F1, { expected_revision: before + 1, reason: 'Lagi' }, { idempotencyKey: key(), requestHash: hash('rv3') }),
      ),
      'INVALID_STATE',
      409,
    );
  });
});

describe('needs', () => {
  it('under the FROZEN clock, the need confirmed last is the current one (seq tie-breaker, not uuid order)', async () => {
    const coord = ctxFor(t, 'COORDINATOR');
    const scores = [41, 77, 63, 90, 58];
    for (const [i, score] of scores.entries()) {
      await withAppTx(coord, (c) =>
        submitNeed(
          c,
          fx.flo.F7,
          { action: 'PROPOSE', category_id: fx.category.STAPLE, score, valid_days: 30, confirm: true },
          { idempotencyKey: key(), requestHash: hash(`nt${i}`) },
        ),
      );
    }
    const list = await withAppTx(ctxFor(t, 'AUDITOR'), (c) => listFlos(c, { ids: [fx.flo.F7] }));
    expect(Number(list.items[0].need.score)).toBe(58);
    expect(new Date(list.items[0].need.assessed_at!).toISOString()).toBe(T_ISO); // all five share the instant
  });

  it('coordinators propose and confirm; auditors cannot; confirmation is a command only', async () => {
    const coord = ctxFor(t, 'COORDINATOR');
    const proposed = await withAppTx(coord, (c) =>
      submitNeed(
        c,
        fx.flo.F5,
        { action: 'PROPOSE', category_id: fx.category.SNACK, score: 72.5, valid_days: 30, confirm: false, requested_qty: '24', unit: 'pack' },
        { idempotencyKey: key(), requestHash: hash('n1') },
      ),
    );
    expect(proposed.status).toBe('PROPOSED');
    expect(new Date(proposed.assessed_at).toISOString()).toBe(T_ISO);
    expect(new Date(proposed.expires_at).toISOString()).toBe('2026-11-25T01:00:00.000Z');

    await expectDomainError(
      withAppTx(ctxFor(t, 'AUDITOR'), (c) =>
        submitNeed(c, fx.flo.F5, { action: 'CONFIRM', need_id: proposed.need_id }, { idempotencyKey: key(), requestHash: hash('n2') }),
      ),
      'FORBIDDEN',
      403,
    );
    // Direct confirmation bypass is denied (no UPDATE grant / policy).
    const bypass = await withAppTx(coord, (c) =>
      c.query(`UPDATE lumbung.need_assessments SET status = 'CONFIRMED', confirmed_by = $2 WHERE id = $1`, [
        proposed.need_id,
        t.users.COORDINATOR.id,
      ]),
    ).catch((x) => x);
    expect((bypass as DomainError).pgCode).toBe('42501');

    const confirmed = await withAppTx(coord, (c) =>
      submitNeed(c, fx.flo.F5, { action: 'CONFIRM', need_id: proposed.need_id }, { idempotencyKey: key(), requestHash: hash('n3') }),
    );
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmed_by).toBe(t.users.COORDINATOR.id);
    const list = await withAppTx(coord, (c) => listFlos(c, { ids: [fx.flo.F5] }));
    expect(list.items[0].need).toMatchObject({ state: 'CONFIRMED', band: 'MEDIUM', score: '72.50', category_code: 'SNACK' });

    await expectDomainError(
      withAppTx(coord, (c) =>
        submitNeed(c, fx.flo.F5, { action: 'CONFIRM', need_id: proposed.need_id }, { idempotencyKey: key(), requestHash: hash('n4') }),
      ),
      'INVALID_STATE',
      409,
    );
    const actions = await withOwner(async (c) =>
      (await c.query(`SELECT action FROM lumbung.audit_events WHERE subject_id = $1 ORDER BY created_at`, [proposed.need_id])).rows,
    );
    expect(actions.map((a) => a.action)).toEqual(['NEED_PROPOSED', 'NEED_CONFIRMED']);
  });
});

describe('SUPERSEDE_PREVIOUS never creates a coverage gap or rewrites history (0015)', () => {
  let ts: TestTenant;
  let fs: FloFixture;
  beforeAll(async () => {
    ts = await makeTenant(ownerPool(), { mode: 'TEST' });
    fs = await buildFloFixture(ownerPool(), ts);
  });
  afterAll(async () => {
    await withOwner(async (c) => {
      await c.query(`SELECT set_config('lumbung.reset_tenant', $1, true)`, [ts.id]);
      await c.query('DELETE FROM lumbung.tenants WHERE id = $1', [ts.id]);
    }).catch(() => undefined);
  });
  const rev = () => ctxFor(ts, 'AGREEMENT_REVIEWER');
  const valid = (flo: string, instant: string) =>
    withAppTx(rev(), async (c) =>
      (await c.query<{ a: string | null }>(`SELECT lumbung.agreement_valid_at($1, $2::timestamptz) AS a`, [flo, instant])).rows[0].a,
    );
  const agreementInvariants = () =>
    withOwner(async (c) =>
      (
        await c.query(
          `SELECT code, subject_id FROM lumbung.verify_tenant_invariants($1)
            WHERE code IN ('HANDOVER_AGREEMENT_INVALID', 'DISPATCH_AGREEMENT_INVALID', 'AGREEMENT_OVERLAP')`,
          [ts.id],
        )
      ).rows,
    );

  it('an early-approved renewal starting in the future keeps the current agreement in force until it starts', async () => {
    // F1: 2026-01-01..2027-06-30 (ACTIVE at T = 2026-10-26). Renewal uploaded from 2027-06-01 (overlap 30 days).
    const up = await withAppTx(rev(), (c) =>
      uploadAgreement(
        c,
        { flo_id: fs.flo.F1, valid_from_date: '2027-06-01', document_end_date: '2028-05-31', end_date_interpretation: 'THROUGH_INCLUSIVE' },
        { idempotencyKey: key(), requestHash: hash('s1') },
      ),
    );
    expect(await agreementInvariants()).toEqual([]);
    const res = await withAppTx(rev(), (c) =>
      approveAgreement(c, up.agreement.id, { expected_revision: 1, overlap_resolution: 'SUPERSEDE_PREVIOUS' }, { idempotencyKey: key(), requestHash: hash('s2') }),
    );
    expect(res.truncated_agreement_ids).toEqual([fs.agreement.F1]);
    expect(res.agreement.status).toBe('SCHEDULED');
    // Still covered now and up to the renewal's start; the renewal takes over exactly then. No gap.
    expect(await valid(fs.flo.F1, T_ISO)).toBe(fs.agreement.F1);
    expect(await valid(fs.flo.F1, '2027-05-31T16:59:59.999Z')).toBe(fs.agreement.F1);
    expect(await valid(fs.flo.F1, '2027-05-31T17:00:00.000Z')).toBe(up.agreement.id);
    const list = await withAppTx(ctxFor(ts, 'AUDITOR'), (c) => listFlos(c, { ids: [fs.flo.F1] }));
    expect(list.items[0].agreement.status).toBe('ACTIVE');
    // Legal dates of the old version are unchanged; its open renewal tasks are DONE (renewed).
    const old = await withOwner(async (c) =>
      (
        await c.query(
          `SELECT a.valid_through_date, a.valid_until_exclusive, a.effective_until, a.superseded_at,
                  (SELECT array_agg(DISTINCT rt.status) FROM lumbung.renewal_tasks rt WHERE rt.agreement_id = a.id) AS task_states
             FROM lumbung.agreements a WHERE a.id = $1`,
          [fs.agreement.F1],
        )
      ).rows[0],
    );
    expect(old.valid_through_date).toBe('2027-06-30');
    expect((old.valid_until_exclusive as Date).toISOString()).toBe('2027-06-30T17:00:00.000Z');
    expect((old.effective_until as Date).toISOString()).toBe('2027-05-31T17:00:00.000Z');
    expect((old.superseded_at as Date).toISOString()).toBe(T_ISO);
    // F1's receipts (T−40d..T−2d) stay covered: no history rewritten.
    expect(await agreementInvariants()).toEqual([]);
  });

  it('a successor starting at/before the old start replaces it (SUPERSEDED) and history before the decision stays valid', async () => {
    // F6: 2025-01-01..2026-09-30 (EXPIRED at T). Replacement from 2025-01-01 through 2025-06-30.
    const up = await withAppTx(rev(), (c) =>
      uploadAgreement(
        c,
        { flo_id: fs.flo.F6, valid_from_date: '2025-01-01', document_end_date: '2025-07-01', end_date_interpretation: 'UNTIL_EXCLUSIVE' },
        { idempotencyKey: key(), requestHash: hash('s3') },
      ),
    );
    expect(up.agreement).toMatchObject({ valid_through_date: '2025-06-30', document_end_date: '2025-07-01', end_date_interpretation: 'UNTIL_EXCLUSIVE' });
    const res = await withAppTx(rev(), (c) =>
      approveAgreement(c, up.agreement.id, { expected_revision: 1, overlap_resolution: 'SUPERSEDE_PREVIOUS' }, { idempotencyKey: key(), requestHash: hash('s4') }),
    );
    expect(res.replaced_agreement_ids).toEqual([fs.agreement.F6]);
    const st = await withOwner(async (c) =>
      (await c.query(`SELECT review_state FROM lumbung.agreements WHERE id = $1`, [fs.agreement.F6])).rows[0].review_state,
    );
    expect(st).toBe('SUPERSEDED');
    // Forward-looking: only the replacement counts. Historical (as recorded at the time): F6 covered 2026-08-01.
    expect(await valid(fs.flo.F6, '2026-08-01T00:00:00Z')).toBeNull();
    const was = await withOwner(async (c) =>
      (
        await c.query(`SELECT lumbung.agreement_was_valid_at_for($1, $2, $3::timestamptz) AS a`, [ts.id, fs.flo.F6, '2026-08-01T00:00:00Z'])
      ).rows[0].a,
    );
    expect(was).toBe(fs.agreement.F6);
  });

  it('refuses a resolution that would leave the FLO without a valid agreement now (AGREEMENT_RESOLUTION_GAP)', async () => {
    // F2: 2025-11-01..2026-10-31 (valid at T). A past-only replacement from 2025-11-01..2025-12-31 would end coverage now.
    const up = await withAppTx(rev(), (c) =>
      uploadAgreement(
        c,
        { flo_id: fs.flo.F2, valid_from_date: '2025-11-01', document_end_date: '2025-12-31', end_date_interpretation: 'THROUGH_INCLUSIVE' },
        { idempotencyKey: key(), requestHash: hash('s5') },
      ),
    );
    await expectDomainError(
      withAppTx(rev(), (c) =>
        approveAgreement(c, up.agreement.id, { expected_revision: 1, overlap_resolution: 'SUPERSEDE_PREVIOUS' }, { idempotencyKey: key(), requestHash: hash('s6') }),
      ),
      'AGREEMENT_RESOLUTION_GAP',
      409,
    );
    expect(await valid(fs.flo.F2, T_ISO)).toBe(fs.agreement.F2);
  });

  it('revocation keeps receipts handed over before revoked_at valid (SC06 history)', async () => {
    expect(await agreementInvariants()).toEqual([]);
    const cur = await withOwner(async (c) =>
      (await c.query(`SELECT revision FROM lumbung.agreements WHERE id = $1`, [fs.agreement.F1])).rows[0].revision as number,
    );
    await withAppTx(rev(), (c) =>
      revokeAgreement(c, fs.agreement.F1, { expected_revision: cur, reason: 'Dokumen dicabut' }, { idempotencyKey: key(), requestHash: hash('s7') }),
    );
    expect(await valid(fs.flo.F1, T_ISO)).toBeNull(); // eligibility from now on is blocked
    // F1 has CURRENT receipts at T−40d..T−2d: they were covered when they happened.
    expect(await agreementInvariants()).toEqual([]);
    const was = await withOwner(async (c) =>
      (
        await c.query(
          `SELECT lumbung.agreement_was_valid_at_for($1, $2, $3::timestamptz) AS before,
                  lumbung.agreement_was_valid_at_for($1, $2, $4::timestamptz) AS at_revocation`,
          [ts.id, fs.flo.F1, '2026-10-26T00:59:59.999Z', T_ISO],
        )
      ).rows[0],
    );
    expect(was).toEqual({ before: fs.agreement.F1, at_revocation: null });
  });

  it('a handover after the revocation is still reported', async () => {
    // A CURRENT receipt for F7 (revoked at T−1d) dated T−12h: not covered then → violation.
    await withOwner(async (c) => {
      const dlv = randomUUID();
      const src = (await c.query(`SELECT id FROM lumbung.source_locations WHERE tenant_id = $1 LIMIT 1`, [ts.id])).rows[0].id;
      await c.query(
        `INSERT INTO lumbung.deliveries (id, tenant_id, code, route, source_location_id, destination_flo_id, state)
         VALUES ($1, $2, 'DLV-REVOKED', 'DIRECT', $3, $4, 'PLANNED')`,
        [dlv, ts.id, src, fs.flo.F7],
      );
      await c.query(
        `INSERT INTO lumbung.flo_receipts (tenant_id, delivery_id, flo_id, received_at, time_source, status)
         VALUES ($1, $2, $3, $4::timestamptz, 'STAFF', 'CURRENT')`,
        [ts.id, dlv, fs.flo.F7, '2026-10-25T13:00:00Z'],
      );
    });
    const rows = await agreementInvariants();
    expect(rows.map((r) => r.code)).toEqual(['HANDOVER_AGREEMENT_INVALID']);
  });
});

describe('upload_agreement stores the document interpretation (PRD §5)', () => {
  it('requires an interpretation and derives the legal last day from it', async () => {
    await expectDomainError(
      withAppTx(reviewer(), (c) =>
        c.query(`SELECT lumbung.upload_agreement($1, NULL, NULL, '2026-12-01', '2027-12-01', NULL, NULL, $2, $3)`, [fx.flo.F5, key(), hash('i0')]),
      ),
      'VALIDATION_FAILED',
      400,
    );
    const res = await withAppTx(reviewer(), (c) =>
      uploadAgreement(
        c,
        {
          flo_id: fx.flo.F5, valid_from_date: '2026-12-01', document_end_date: '2027-12-01',
          end_date_interpretation: 'UNTIL_EXCLUSIVE', interpretation_note: 'Pasal 7: "berakhir pada tanggal 1 Desember 2027"',
        },
        { idempotencyKey: key(), requestHash: hash('i1') },
      ),
    );
    expect(res.agreement).toMatchObject({
      valid_through_date: '2027-11-30',
      document_end_date: '2027-12-01',
      end_date_interpretation: 'UNTIL_EXCLUSIVE',
      interpretation_note: 'Pasal 7: "berakhir pada tanggal 1 Desember 2027"',
    });
    expect(new Date(res.agreement.valid_until_exclusive).toISOString()).toBe('2027-11-30T17:00:00.000Z');
    const audit = await withOwner(async (c) =>
      (await c.query(`SELECT payload FROM lumbung.audit_events WHERE subject_id = $1 AND action = 'AGREEMENT_UPLOADED'`, [res.agreement.id])).rows[0],
    );
    expect(audit.payload).toMatchObject({ document_end_date: '2027-12-01', end_date_interpretation: 'UNTIL_EXCLUSIVE', valid_through_date: '2027-11-30' });
  });
});
