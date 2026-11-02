/**
 * GET /api/audit: capability, tenant isolation, filters (WIB dates) and stable opaque
 * cursor pagination, against the real test database.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/src/config/env';
import { signSession } from '@/src/security/session';
import { encodeCursor } from '@/src/http/pagination';
import * as auditRoute from '@/app/api/audit/route';
import { makeTenant, withOwner, type TestTenant } from '../setup/db-helpers';

let a: TestTenant;
let b: TestTenant;
/** Owner-truth ordering of tenant A's events: newest first, (occurred_at DESC, seq DESC) = insertion order on ties. */
let expectedIds: string[];
const subjectA = randomUUID();

function cookie(userId: string, tenantId: string) {
  return `lb_session=${signSession({ uid: userId, tid: tenantId }, { secret: getEnv().SESSION_SECRET, now: new Date() })}`;
}

async function get(qs: string, who: { id: string; tenant: string } | null) {
  const headers: Record<string, string> = {};
  if (who) headers.cookie = cookie(who.id, who.tenant);
  const res = await auditRoute.GET(new Request(`http://x/api/audit${qs}`, { headers }));
  return { res, body: (await res.json()) as { data?: { items: { id: string }[]; next_cursor: string | null }; error?: { code: string } } };
}

const asAuditor = () => ({ id: a.users.AUDITOR.id, tenant: a.id });

async function insertEvent(
  t: TestTenant,
  e: { occurred_at: string; action: string; subject_type: string; actor?: string | null; actor_kind?: string; subject_id?: string; id?: string },
) {
  const id = e.id ?? randomUUID();
  await withOwner((c) =>
    c.query(
      `INSERT INTO lumbung.audit_events (id, tenant_id, actor_id, actor_kind, action, subject_type, subject_id, occurred_at, reason, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10::jsonb)`,
      [id, t.id, e.actor ?? null, e.actor_kind ?? 'USER', e.action, e.subject_type, e.subject_id ?? null, e.occurred_at, 'uji', JSON.stringify({ n: 1 })],
    ),
  );
  return id;
}

beforeAll(async () => {
  a = await makeTenant();
  b = await makeTenant();
  const coord = a.users.COORDINATOR.id;
  const reviewer = a.users.AGREEMENT_REVIEWER.id;
  // Ties on occurred_at (same microsecond) and microsecond-only differences on purpose.
  const rows: Parameters<typeof insertEvent>[1][] = [
    { occurred_at: '2026-10-25T16:59:59.999999Z', action: 'flo.update', subject_type: 'FLO', actor: coord }, // 25 Oct 23:59:59 WIB
    { occurred_at: '2026-10-25T17:00:00.000000Z', action: 'flo.update', subject_type: 'FLO', actor: coord }, // 26 Oct 00:00 WIB
    { occurred_at: '2026-10-26T01:00:00.000001Z', action: 'agreement.approve', subject_type: 'AGREEMENT', actor: reviewer, subject_id: subjectA },
    { occurred_at: '2026-10-26T01:00:00.000002Z', action: 'agreement.approve', subject_type: 'AGREEMENT', actor: reviewer },
    { occurred_at: '2026-10-26T01:00:00.000002Z', action: 'agreement.revoke', subject_type: 'AGREEMENT', actor: reviewer, subject_id: subjectA },
    { occurred_at: '2026-10-26T01:00:00.000002Z', action: 'agreement.upload', subject_type: 'AGREEMENT', actor: coord },
    { occurred_at: '2026-10-26T16:59:59.999999Z', action: 'job.run', subject_type: 'JOB', actor: null, actor_kind: 'WORKER' }, // 26 Oct 23:59:59 WIB
    { occurred_at: '2026-10-26T17:00:00.000000Z', action: 'job.run', subject_type: 'JOB', actor: null, actor_kind: 'WORKER' }, // 27 Oct WIB
  ];
  for (const r of rows) await insertEvent(a, r);
  await insertEvent(b, { occurred_at: '2026-10-26T02:00:00Z', action: 'flo.update', subject_type: 'FLO', actor: b.users.COORDINATOR.id });

  const truth = await withOwner((c) =>
    c.query<{ id: string }>(
      'SELECT id FROM lumbung.audit_events WHERE tenant_id = $1 ORDER BY occurred_at DESC, seq DESC',
      [a.id],
    ),
  );
  expectedIds = truth.rows.map((r) => r.id);
});

async function collectAll(qs: string, limit: number) {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const sep = qs ? '&' : '?';
    const { res, body } = await get(`${qs}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`, asAuditor());
    expect(res.status).toBe(200);
    seen.push(...body.data!.items.map((i) => i.id));
    cursor = body.data!.next_cursor;
    pages++;
    expect(pages).toBeLessThan(50);
  } while (cursor);
  return { seen, pages };
}

describe('GET /api/audit', () => {
  it('requires a session (401) and the audit.read capability (403)', async () => {
    expect((await get('', null)).res.status).toBe(401);

    // A member with no capabilities at all (G.3 gives audit.read to every role bundle).
    const uid = randomUUID();
    await withOwner(async (c) => {
      await c.query(`INSERT INTO lumbung.users (id, display_name, email, kind) VALUES ($1, 'Tanpa Izin', $2, 'HUMAN')`, [
        uid,
        `nocap.${a.slug}@example.invalid`,
      ]);
      await c.query(
        `INSERT INTO lumbung.memberships (tenant_id, user_id, role_label, capabilities, status) VALUES ($1, $2, 'NONE', '{}', 'ACTIVE')`,
        [a.id, uid],
      );
    });
    const r = await get('', { id: uid, tenant: a.id });
    expect(r.res.status).toBe(403);
    expect(r.body.error!.code).toBe('CAPABILITY_REQUIRED');
  });

  it('returns only the caller tenant’s events, newest first', async () => {
    const { res, body } = await get('?limit=200', asAuditor());
    expect(res.status).toBe(200);
    expect(body.data!.items.map((i) => i.id)).toEqual(expectedIds);
    expect(body.data!.next_cursor).toBeNull();

    const other = await get('?limit=200', { id: b.users.AUDITOR.id, tenant: b.id });
    expect(other.body.data!.items).toHaveLength(1);
    expect(expectedIds).not.toContain(other.body.data!.items[0].id);
  });

  it('paginates with a stable opaque cursor: every page size yields the exact order, no gaps or repeats', async () => {
    for (const limit of [1, 2, 3, 5, 7]) {
      const { seen, pages } = await collectAll('', limit);
      expect(seen).toEqual(expectedIds);
      expect(pages).toBe(Math.ceil(expectedIds.length / limit));
    }
  });

  it('keeps later pages stable when newer events are appended mid-pagination', async () => {
    const first = await get('?limit=3', asAuditor());
    const firstIds = first.body.data!.items.map((i) => i.id);
    // A brand-new event (newest of all) arrives between page requests.
    const newer = await insertEvent(a, { occurred_at: '2026-10-28T00:00:00Z', action: 'flo.update', subject_type: 'FLO', actor: a.users.COORDINATOR.id });
    const rest: string[] = [];
    let cursor = first.body.data!.next_cursor;
    while (cursor) {
      const p = await get(`?limit=3&cursor=${cursor}`, asAuditor());
      rest.push(...p.body.data!.items.map((i) => i.id));
      cursor = p.body.data!.next_cursor;
    }
    expect([...firstIds, ...rest]).toEqual(expectedIds);
    expect(rest).not.toContain(newer);
    expectedIds = [newer, ...expectedIds];
  });

  it('orders same-instant events by insertion (FROZEN clock), not by random UUID', async () => {
    const t2 = await makeTenant();
    // Inserted first, but with the lexically largest id; under (occurred_at, id) it would sort first.
    const firstDone = await insertEvent(t2, { occurred_at: '2026-10-26T01:00:00Z', action: 'AGREEMENT_SUPERSEDED', subject_type: 'AGREEMENT', id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' });
    const thenDone = await insertEvent(t2, { occurred_at: '2026-10-26T01:00:00Z', action: 'AGREEMENT_APPROVED', subject_type: 'AGREEMENT', id: '00000000-0000-4000-8000-000000000001' });
    const r = await get('?limit=200', { id: t2.users.AUDITOR.id, tenant: t2.id });
    expect(r.body.data!.items.map((i) => i.id)).toEqual([thenDone, firstDone]);
    // And page by page.
    const p1 = await get('?limit=1', { id: t2.users.AUDITOR.id, tenant: t2.id });
    const p2 = await get(`?limit=1&cursor=${p1.body.data!.next_cursor}`, { id: t2.users.AUDITOR.id, tenant: t2.id });
    expect([p1.body.data!.items[0].id, p2.body.data!.items[0].id]).toEqual([thenDone, firstDone]);
  });

  it('filters by subject type, action, actor, actor kind and subject id', async () => {
    const byType = await get('?subject_type=AGREEMENT&limit=200', asAuditor());
    expect(byType.body.data!.items).toHaveLength(4);

    const byAction = await get('?action=agreement.approve&limit=200', asAuditor());
    expect(byAction.body.data!.items).toHaveLength(2);

    const byActor = await get(`?actor_id=${a.users.AGREEMENT_REVIEWER.id}&limit=200`, asAuditor());
    expect(byActor.body.data!.items).toHaveLength(3);

    const byKind = await get('?actor_kind=WORKER&limit=200', asAuditor());
    expect(byKind.body.data!.items).toHaveLength(2);

    const bySubject = await get(`?subject_id=${subjectA}&limit=200`, asAuditor());
    expect(bySubject.body.data!.items).toHaveLength(2);

    // Empty values from an HTML GET form mean "no filter".
    const blank = await get('?subject_type=&action=&actor_id=&from=&to=&limit=200', asAuditor());
    expect(blank.body.data!.items).toHaveLength(expectedIds.length);
  });

  it('filters by local WIB calendar dates (inclusive), independent of the server time zone', async () => {
    const day26 = await get('?from=2026-10-26&to=2026-10-26&limit=200', asAuditor());
    // 26 Oct WIB = [2026-10-25T17:00Z, 2026-10-26T17:00Z): 00:00 WIB .. 23:59:59.999999 WIB
    expect(day26.body.data!.items).toHaveLength(6);

    const day25 = await get('?to=2026-10-25&limit=200', asAuditor());
    expect(day25.body.data!.items).toHaveLength(1);

    const from27 = await get('?from=2026-10-27&limit=200', asAuditor());
    // 27 Oct 00:00 WIB worker event + the event appended in the stability test (28 Oct).
    expect(from27.body.data!.items).toHaveLength(2);

    // Paginating a filtered set is equally stable.
    const { seen } = await collectAll('?from=2026-10-26&to=2026-10-26', 2);
    expect(seen).toEqual(day26.body.data!.items.map((i) => i.id));
  });

  it('rejects invalid filters and tampered cursors with 400, without leaking', async () => {
    const badDate = await get('?from=2026-13-01', asAuditor());
    expect(badDate.res.status).toBe(400);
    expect(badDate.body.error!.code).toBe('VALIDATION_FAILED');

    const reversed = await get('?from=2026-10-27&to=2026-10-26', asAuditor());
    expect(reversed.res.status).toBe(400);

    const injected = await get(`?subject_type=${encodeURIComponent("FLO' OR 1=1 --")}`, asAuditor());
    expect(injected.res.status).toBe(400);

    for (const cursor of [
      'not-base64!',
      Buffer.from('{"a":1}').toString('base64url'),
      encodeCursor('2026-10-26T01:00:00Z', randomUUID()), // ms-less key: not one of ours
      encodeCursor('2026-10-26T01:00:00.000000Z', 'not-a-seq'),
      encodeCursor('2026-10-26T01:00:00.000000Z', randomUUID()), // pre-0015 (uuid) cursor
    ]) {
      const r = await get(`?cursor=${cursor}`, asAuditor());
      expect(r.res.status).toBe(400);
      expect(r.body.error!.code).toBe('BAD_REQUEST');
    }

    const tooBig = await get('?limit=1000', asAuditor());
    expect(tooBig.res.status).toBe(400);
  });
});
