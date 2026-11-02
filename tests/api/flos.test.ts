/**
 * W2-FLO API tests: route handlers called directly with Request objects and a signed
 * lb_session cookie, against the real embedded Postgres (RLS as lumbung_app).
 * Fixture: tests/db/agreement-fixtures.ts (exact R/E/history numbers).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- assertions over parsed JSON envelopes */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/src/config/env';
import { signSession } from '@/src/security/session';
import { makeTenant, ownerPool, withOwner, type TestTenant } from '../setup/db-helpers';
import { buildFloFixture, type FloFixture } from '../db/agreement-fixtures';
import * as flosRoute from '@/app/api/flos/route';
import * as floRoute from '@/app/api/flos/[id]/route';
import * as needsRoute from '@/app/api/flos/[id]/needs/route';
import * as agreementsRoute from '@/app/api/agreements/route';
import * as approveRoute from '@/app/api/agreements/[id]/approve/route';
import * as revokeRoute from '@/app/api/agreements/[id]/revoke/route';

type Role = keyof TestTenant['users'];

let t: TestTenant;
let b: TestTenant;
let fx: FloFixture;

beforeAll(async () => {
  t = await makeTenant(ownerPool(), { mode: 'TEST' });
  fx = await buildFloFixture(ownerPool(), t);
  b = await makeTenant(ownerPool(), { mode: 'TEST' });
});

afterAll(async () => {
  for (const id of [t?.id, b?.id].filter(Boolean)) {
    await withOwner(async (c) => {
      await c.query(`SELECT set_config('lumbung.reset_tenant', $1, true)`, [id]);
      await c.query('DELETE FROM lumbung.tenants WHERE id = $1', [id]);
    }).catch(() => undefined);
  }
});

function cookie(tenant: TestTenant, role: Role): string {
  const token = signSession({ uid: tenant.users[role].id, tid: tenant.id }, { secret: getEnv().SESSION_SECRET, now: new Date() });
  return `lb_session=${token}`;
}

function req(
  path: string,
  opts: { method?: string; as?: [TestTenant, Role] | null; body?: unknown; key?: string | null } = {},
): Request {
  const headers = new Headers();
  if (opts.as) headers.set('cookie', cookie(opts.as[0], opts.as[1]));
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  if (opts.key) headers.set('idempotency-key', opts.key);
  return new Request(`http://localhost${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

async function json(res: Response) {
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const codesOf = (body: Record<string, any>) => (body.data.items as { code: string }[]).map((i) => i.code);

describe('GET /api/flos', () => {
  it('requires a session (401) and flo.read', async () => {
    const r = await json(await flosRoute.GET(req('/api/flos')));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');

    const forged = new Request('http://localhost/api/flos', { headers: { cookie: 'lb_session=abc.def' } });
    expect((await flosRoute.GET(forged)).status).toBe(401);
  });

  it('lists the tenant directory with derived agreement status and counts', async () => {
    const r = await json(await flosRoute.GET(req('/api/flos', { as: [t, 'AUDITOR'] })));
    expect(r.status).toBe(200);
    expect(codesOf(r.body)).toEqual(['FLO-0001', 'FLO-0002', 'FLO-0003', 'FLO-0004', 'FLO-0005', 'FLO-0006', 'FLO-0007']);
    expect(r.body.data.total).toBe(7);
    expect(r.body.data.now).toBe('2026-10-26T01:00:00.000Z');
    expect(r.body.data.agreement_counts).toEqual({
      ACTIVE: 1,
      EXPIRING_SOON: 2,
      SCHEDULED: 0,
      EXPIRED: 1,
      PENDING: 1,
      REVOKED: 1,
      NONE: 1,
    });
    const byCode = Object.fromEntries((r.body.data.items as any[]).map((i) => [i.code, i]));
    expect(byCode['FLO-0001'].agreement).toMatchObject({ status: 'ACTIVE', valid_through_date: '2027-06-30', has_pending_version: false });
    expect(byCode['FLO-0002'].agreement).toMatchObject({
      status: 'EXPIRING_SOON',
      valid_through_date: '2026-10-31',
      valid_until_exclusive: '2026-10-31T17:00:00.000Z',
    });
    expect(byCode['FLO-0003'].agreement).toMatchObject({ status: 'EXPIRING_SOON', has_pending_version: true });
    expect(byCode['FLO-0004'].agreement.status).toBe('PENDING');
    expect(byCode['FLO-0005'].agreement.status).toBe('NONE');
    expect(byCode['FLO-0006'].agreement).toMatchObject({ status: 'EXPIRED', valid_through_date: '2026-09-30' });
    expect(byCode['FLO-0007'].agreement.status).toBe('REVOKED');
  });

  it('derives R and E from raw history with the PRD smoothing (never stored)', async () => {
    const r = await json(await flosRoute.GET(req('/api/flos?q=FLO-0001', { as: [t, 'COORDINATOR'] })));
    const f1 = r.body.data.items[0];
    expect(f1.response).toEqual({ eligible: 6, timely: 5, excluded: 1, value: 0.7, band: 'HIGH' });
    // BAST: 3 on-time + 1 late → (3.5+2)/(4+4); RECEIPT_PHOTO: 1+1+0+0 → (2+2)/(4+4); DISTRIBUTION: none → 0.5
    expect(f1.reporting.by_type.BAST).toEqual({ n: 4, sum: 3.5, value: 5.5 / 8 });
    expect(f1.reporting.by_type.RECEIPT_PHOTO).toEqual({ n: 4, sum: 2, value: 0.5 });
    expect(f1.reporting.by_type.DISTRIBUTION).toEqual({ n: 0, sum: 0, value: 0.5 });
    expect(f1.reporting.n).toBe(8);
    expect(f1.reporting.value).toBeCloseTo(0.4 * (5.5 / 8) + 0.3 * 0.5 + 0.3 * 0.5, 12);
    expect(f1.need).toMatchObject({ state: 'CONFIRMED', band: 'HIGH', score: '90.00', category_code: 'BREAD' });
    expect(f1.people_per_event).toBe(60);
    expect(f1.schedule_verified).toBe(true);
    expect(f1.primary_cluster).toMatchObject({ code: 'JKT-SUNTER' });

    // A NEW FLO: insufficient history = neutral 0.5 with sample count 0 (AC46), not a red zero.
    const n = await json(await flosRoute.GET(req('/api/flos?q=FLO-0005', { as: [t, 'COORDINATOR'] })));
    const f5 = n.body.data.items[0];
    expect(f5.tenure).toBe('NEW');
    expect(f5.response).toEqual({ eligible: 0, timely: 0, excluded: 0, value: 0.5, band: 'INSUFFICIENT' });
    expect(f5.reporting).toMatchObject({ n: 0, value: 0.5 });
    expect(f5.need).toMatchObject({ state: 'MISSING', band: 'MISSING', score: null });
  });

  it('filters by area, cluster, type, agreement, need, response and search', async () => {
    const get = async (qs: string) => codesOf((await json(await flosRoute.GET(req(`/api/flos?${qs}`, { as: [t, 'AUDITOR'] })))).body);
    expect(await get('area=BEKASI')).toEqual(['FLO-0003', 'FLO-0004', 'FLO-0007']);
    expect(await get(`cluster=${fx.cluster.SUNTER}`)).toEqual(['FLO-0001', 'FLO-0002', 'FLO-0006']);
    expect(await get('type=PANTI')).toEqual(['FLO-0001', 'FLO-0003', 'FLO-0006']);
    expect(await get('agreement=EXPIRING_SOON')).toEqual(['FLO-0002', 'FLO-0003']);
    expect(await get('agreement=EXPIRED')).toEqual(['FLO-0006']);
    expect(await get('need=HIGH')).toEqual(['FLO-0001']);
    expect(await get('need=STALE')).toEqual(['FLO-0002']);
    expect(await get('response=HIGH')).toEqual(['FLO-0001']);
    expect((await get('response=INSUFFICIENT')).length).toBe(6);
    expect(await get('q=mawar')).toEqual(['FLO-0001']);
    expect(await get('q=%25')).toEqual([]); // LIKE metacharacters are literal
    expect(await get('area=BEKASI&type=PANTI&agreement=EXPIRING_SOON')).toEqual(['FLO-0003']);
    // Empty values from the HTML filter form mean "no filter".
    expect((await get('area=&type=&agreement=')).length).toBe(7);

    const bad = await json(await flosRoute.GET(req('/api/flos?area=MARS', { as: [t, 'AUDITOR'] })));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.field_errors.area).toBeTruthy();
  });

  it('paginates with an opaque cursor in stable code order', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await json(await flosRoute.GET(req(`/api/flos?${qs}`, { as: [t, 'AUDITOR'] })));
      expect(r.status).toBe(200);
      expect(r.body.data.total).toBe(7);
      seen.push(...codesOf(r.body));
      cursor = r.body.data.next_cursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(['FLO-0001', 'FLO-0002', 'FLO-0003', 'FLO-0004', 'FLO-0005', 'FLO-0006', 'FLO-0007']);

    const bad = await json(await flosRoute.GET(req('/api/flos?cursor=not-a-cursor!', { as: [t, 'AUDITOR'] })));
    expect(bad.status).toBe(400);
  });

  it('never shows another tenant’s FLOs', async () => {
    const r = await json(await flosRoute.GET(req('/api/flos', { as: [b, 'ADMIN_COORDINATOR'] })));
    expect(r.status).toBe(200);
    expect(r.body.data.items).toEqual([]);
    expect(r.body.data.total).toBe(0);
    expect(r.body.data.tenant_total).toBe(0);
  });
});

describe('GET /api/flos/[id]', () => {
  it('returns the detail with category history (unit-aware, strict windows)', async () => {
    const r = await json(await floRoute.GET(req(`/api/flos/${fx.flo.F1}`, { as: [t, 'COORDINATOR'] }), params({ id: fx.flo.F1 })));
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(1);
    const d = r.body.data;
    expect(d.profile).toMatchObject({ code: 'FLO-0001', flo_type: 'PANTI', tenure: 'ESTABLISHED', revision: 1 });
    const hist = Object.fromEntries((d.history as any[]).map((h) => [`${h.category_code}:${h.unit}`, h]));
    // BREAD: 40 (T−2d) in 7d; 40 + 30 in 30d; the superseded 999 line is not counted.
    expect(hist['BREAD:portion']).toMatchObject({ qty_7d: '40.000', qty_30d: '70.000', rejected_30d: '5.000', receipts_30d: 2, comparable: true });
    expect(hist['SNACK:pack']).toMatchObject({ qty_7d: '12.000', qty_30d: '12.000' });
    // STAPLE received 40 days ago: listed, zero in both strict windows.
    expect(hist['STAPLE:kg']).toMatchObject({ qty_7d: '0', qty_30d: '0' });
    expect(hist['STAPLE:kg'].last_received_at).toBe('2026-09-16T01:00:00.000Z');
    expect((d.recent_receipts as any[]).some((x) => x.accepted_qty === '999.000')).toBe(false);

    const rp = (d.reporting.by_type as any[]).find((x) => x.type === 'RECEIPT_PHOTO');
    expect(rp).toMatchObject({ n: 4, on_time: 2, missing: 2, pending_review: 1, open_not_due: 1, excused: 1, value: 0.5 });
    expect(d.responsiveness).toMatchObject({ eligible: 6, timely: 5, excluded: 1, value: 0.7 });
    expect(d.schedules[0]).toMatchObject({ declared_count: 62, verified_count: 60, count_basis: 'DAILY_RESIDENTS', current: true });
    expect(d.agreements.map((a: any) => a.status)).toEqual(['ACTIVE']);
  });

  it('decrypts contacts only for flo.edit holders and audit only for audit.read holders', async () => {
    const coord = await json(await floRoute.GET(req(`/api/flos/${fx.flo.F1}`, { as: [t, 'COORDINATOR'] }), params({ id: fx.flo.F1 })));
    expect(coord.body.data.contacts[0]).toMatchObject({ address: 'sim:flo:0001', address_hint: 'sim:flo:00**', decrypt_failed: false });
    expect(coord.body.data.audit).toEqual([]);

    const auditor = await json(await floRoute.GET(req(`/api/flos/${fx.flo.F1}`, { as: [t, 'AUDITOR'] }), params({ id: fx.flo.F1 })));
    expect(auditor.body.data.contacts[0]).toMatchObject({ address: null, address_hint: 'sim:flo:00**' });
    expect(auditor.body.data.contacts_revealed).toBe(false);
    expect(JSON.stringify(auditor.body)).not.toContain('sim:flo:0001');

    const wh = await json(await floRoute.GET(req(`/api/flos/${fx.flo.F1}`, { as: [t, 'WAREHOUSE'] }), params({ id: fx.flo.F1 })));
    expect(wh.status).toBe(200);
    expect(wh.body.data.contacts[0].address).toBeNull();
  });

  it('answers 404 for another tenant’s id, unknown ids and malformed ids (no existence leak)', async () => {
    const cross = await json(await floRoute.GET(req(`/api/flos/${fx.flo.F1}`, { as: [b, 'ADMIN_COORDINATOR'] }), params({ id: fx.flo.F1 })));
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
    const unknown = await json(await floRoute.GET(req(`/api/flos/${randomUUID()}`, { as: [t, 'AUDITOR'] }), params({ id: randomUUID() })));
    expect(unknown.status).toBe(404);
    const malformed = await json(await floRoute.GET(req('/api/flos/abc', { as: [t, 'AUDITOR'] }), params({ id: 'abc' })));
    expect(malformed.status).toBe(404);
    expect(cross.body.error).toEqual(unknown.body.error);

    const unauth = await json(await floRoute.GET(req(`/api/flos/${fx.flo.F1}`), params({ id: fx.flo.F1 })));
    expect(unauth.status).toBe(401);
  });
});

describe('mutations', () => {
  it('POST /api/flos creates a draft (NEW, unverified) and requires an Idempotency-Key', async () => {
    const body = { name: 'Komunitas Draf Uji', flo_type: 'NON_PANTI', service_model: 'COMMUNITY_KITCHEN', area: 'DEPOK' };
    const noKey = await json(await flosRoute.POST(req('/api/flos', { method: 'POST', as: [t, 'COORDINATOR'], body })));
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const auditor = await json(await flosRoute.POST(req('/api/flos', { method: 'POST', as: [t, 'AUDITOR'], body, key: randomUUID() })));
    expect(auditor.status).toBe(403);

    const key = randomUUID();
    const created = await json(await flosRoute.POST(req('/api/flos', { method: 'POST', as: [t, 'COORDINATOR'], body, key })));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: 'FLO-0008', status: 'PAUSED', tenure: 'NEW', revision: 1 });
    const replay = await json(await flosRoute.POST(req('/api/flos', { method: 'POST', as: [t, 'COORDINATOR'], body, key })));
    expect(replay.body.data).toEqual(created.body.data);
    const mismatch = await json(
      await flosRoute.POST(req('/api/flos', { method: 'POST', as: [t, 'COORDINATOR'], body: { ...body, area: 'BOGOR' }, key })),
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');

    const list = await json(await flosRoute.GET(req('/api/flos?q=FLO-0008', { as: [t, 'AUDITOR'] })));
    expect(list.body.data.items[0]).toMatchObject({ location_confidence: 'UNVERIFIED', agreement: { status: 'NONE' } });
  });

  it('PATCH /api/flos/[id] is revision-guarded and audited', async () => {
    const id = fx.flo.F6;
    const ok = await json(
      await floRoute.PATCH(
        req(`/api/flos/${id}`, {
          method: 'PATCH',
          as: [t, 'COORDINATOR'],
          key: randomUUID(),
          body: { expected_revision: 1, patch: { address: 'Jl. Baru 6', cooking_capable: true } },
        }),
        params({ id }),
      ),
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ revision: 2, changed: ['address', 'cooking_capable'] });
    expect(ok.body.revision).toBe(2);

    const stale = await json(
      await floRoute.PATCH(
        req(`/api/flos/${id}`, {
          method: 'PATCH',
          as: [t, 'COORDINATOR'],
          key: randomUUID(),
          body: { expected_revision: 1, patch: { name: 'Nama Lama' } },
        }),
        params({ id }),
      ),
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');

    const notEditable = await json(
      await floRoute.PATCH(
        req(`/api/flos/${id}`, { method: 'PATCH', as: [t, 'COORDINATOR'], key: randomUUID(), body: { expected_revision: 2, patch: { tenure: 'NEW' } } }),
        params({ id }),
      ),
    );
    expect(notEditable.status).toBe(400);

    const cross = await json(
      await floRoute.PATCH(
        req(`/api/flos/${id}`, { method: 'PATCH', as: [b, 'ADMIN_COORDINATOR'], key: randomUUID(), body: { expected_revision: 2, patch: { name: 'Bocor' } } }),
        params({ id }),
      ),
    );
    expect(cross.status).toBe(404);

    const detail = await json(await floRoute.GET(req(`/api/flos/${id}`, { as: [t, 'AUDITOR'] }), params({ id })));
    expect((detail.body.data.audit as any[]).map((a) => a.action)).toContain('FLO_PROFILE_UPDATED');
  });

  it('POST /api/flos/[id]/needs proposes and (with need.confirm) confirms', async () => {
    const id = fx.flo.F4;
    const body = { action: 'PROPOSE', category_id: fx.category.BREAD, score: 81, confirm: true, basis: 'Kunjungan staf' };
    const auditor = await json(await needsRoute.POST(req(`/api/flos/${id}/needs`, { method: 'POST', as: [t, 'AUDITOR'], body, key: randomUUID() }), params({ id })));
    expect(auditor.status).toBe(403);
    const r = await json(await needsRoute.POST(req(`/api/flos/${id}/needs`, { method: 'POST', as: [t, 'COORDINATOR'], body, key: randomUUID() }), params({ id })));
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'CONFIRMED', score: 81 });
    const list = await json(await flosRoute.GET(req('/api/flos?need=HIGH', { as: [t, 'AUDITOR'] })));
    expect(codesOf(list.body)).toContain('FLO-0004');

    const cross = await json(await needsRoute.POST(req(`/api/flos/${id}/needs`, { method: 'POST', as: [b, 'ADMIN_COORDINATOR'], body, key: randomUUID() }), params({ id })));
    expect(cross.status).toBe(404);
  });

  it('PROPOSE+confirm accepts a maximum-length (200-char) Idempotency-Key and replays it', async () => {
    const id = fx.flo.F4;
    const body = { action: 'PROPOSE', category_id: fx.category.SNACK, score: 64, confirm: true, basis: 'Kunjungan staf' };
    const key = `k-${randomUUID()}-`.padEnd(200, 'x');
    expect(key).toHaveLength(200);
    const first = await json(await needsRoute.POST(req(`/api/flos/${id}/needs`, { method: 'POST', as: [t, 'COORDINATOR'], body, key }), params({ id })));
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ status: 'CONFIRMED', score: 64 });
    const replay = await json(await needsRoute.POST(req(`/api/flos/${id}/needs`, { method: 'POST', as: [t, 'COORDINATOR'], body, key }), params({ id })));
    expect(replay.status).toBe(201);
    expect(replay.body.data.need_id).toBe(first.body.data.need_id);
  });

  it('agreement upload → approve → revoke through the API', async () => {
    const reviewer: [TestTenant, Role] = [t, 'AGREEMENT_REVIEWER'];
    const up = await json(
      await agreementsRoute.POST(
        req('/api/agreements', {
          method: 'POST',
          as: reviewer,
          key: randomUUID(),
          body: { flo_id: fx.flo.F7, signed_date: '2026-10-20', valid_from_date: '2026-11-01', document_end_date: '2027-10-31', end_date_interpretation: 'THROUGH_INCLUSIVE' },
        }),
      ),
    );
    expect(up.status).toBe(201);
    const aid = up.body.data.agreement.id as string;
    expect(up.body.data.agreement).toMatchObject({ review_state: 'PENDING_VERIFICATION', version: 2, valid_until_exclusive: '2027-10-31T17:00:00+00:00' });

    const coordUpload = await json(
      await agreementsRoute.POST(
        req('/api/agreements', { method: 'POST', as: [t, 'COORDINATOR'], key: randomUUID(), body: { flo_id: fx.flo.F7, valid_from_date: '2026-11-01', document_end_date: '2027-10-31', end_date_interpretation: 'THROUGH_INCLUSIVE' } }),
      ),
    );
    expect(coordUpload.status).toBe(403);

    // Approve: Idempotency-Key required; coordinator forbidden (403, not 404); cross-tenant 404.
    const noKey = await json(await approveRoute.POST(req(`/api/agreements/${aid}/approve`, { method: 'POST', as: reviewer, body: { expected_revision: 1 } }), params({ id: aid })));
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const coord = await json(
      await approveRoute.POST(req(`/api/agreements/${aid}/approve`, { method: 'POST', as: [t, 'COORDINATOR'], key: randomUUID(), body: { expected_revision: 1 } }), params({ id: aid })),
    );
    expect(coord.status).toBe(403);
    expect(coord.body.error.code).toBe('CAPABILITY_REQUIRED');
    const cross = await json(
      await approveRoute.POST(req(`/api/agreements/${aid}/approve`, { method: 'POST', as: [b, 'AGREEMENT_REVIEWER'], key: randomUUID(), body: { expected_revision: 1 } }), params({ id: aid })),
    );
    expect(cross.status).toBe(404);

    const key = randomUUID();
    const approved = await json(
      await approveRoute.POST(req(`/api/agreements/${aid}/approve`, { method: 'POST', as: reviewer, key, body: { expected_revision: 1 } }), params({ id: aid })),
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.agreement).toMatchObject({ review_state: 'APPROVED', status: 'SCHEDULED', revision: 2 });
    expect(approved.body.revision).toBe(2);
    const replay = await json(
      await approveRoute.POST(req(`/api/agreements/${aid}/approve`, { method: 'POST', as: reviewer, key, body: { expected_revision: 1 } }), params({ id: aid })),
    );
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(approved.body.data);
    const mismatch = await json(
      await approveRoute.POST(
        req(`/api/agreements/${aid}/approve`, { method: 'POST', as: reviewer, key, body: { expected_revision: 1, overlap_resolution: 'SUPERSEDE_PREVIOUS' } }),
        params({ id: aid }),
      ),
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');

    const list = await json(await flosRoute.GET(req('/api/flos?q=FLO-0007', { as: [t, 'AUDITOR'] })));
    expect(list.body.data.items[0].agreement).toMatchObject({ status: 'SCHEDULED', valid_from_date: '2026-11-01' });

    const noReason = await json(
      await revokeRoute.POST(req(`/api/agreements/${aid}/revoke`, { method: 'POST', as: reviewer, key: randomUUID(), body: { expected_revision: 2 } }), params({ id: aid })),
    );
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.field_errors.reason).toBeTruthy();
    const revoked = await json(
      await revokeRoute.POST(
        req(`/api/agreements/${aid}/revoke`, { method: 'POST', as: reviewer, key: randomUUID(), body: { expected_revision: 2, reason: 'Penandatangan tidak berwenang' } }),
        params({ id: aid }),
      ),
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.agreement).toMatchObject({ review_state: 'REVOKED', revoke_reason: 'Penandatangan tidak berwenang' });

    const overlapUp = await json(
      await agreementsRoute.POST(
        req('/api/agreements', { method: 'POST', as: reviewer, key: randomUUID(), body: { flo_id: fx.flo.F3, valid_from_date: '2026-10-15', document_end_date: '2027-10-14', end_date_interpretation: 'THROUGH_INCLUSIVE' } }),
      ),
    );
    const oid = overlapUp.body.data.agreement.id as string;
    const overlap = await json(
      await approveRoute.POST(req(`/api/agreements/${oid}/approve`, { method: 'POST', as: reviewer, key: randomUUID(), body: { expected_revision: 1 } }), params({ id: oid })),
    );
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('AGREEMENT_OVERLAP_UNRESOLVED');
  });
});
