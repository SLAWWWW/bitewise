import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { DomainError } from '@/src/db/errors';
import { handler } from '@/src/http/handler';
import { computeRequestHash } from '@/src/http/idempotency';

const url = 'http://localhost:3000/api/things/11111111-1111-5111-8111-111111111111/approve';
const params = Promise.resolve({ id: '11111111-1111-5111-8111-111111111111' });

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('handler()', () => {
  const schema = z.object({ expected_revision: z.number().int().positive(), reason: z.string().min(3) });

  it('returns the success envelope and echoes a valid correlation id', async () => {
    const h = handler({ auth: 'none', body: schema }, async ({ body, ok }) => ok({ echoed: body.reason }, { revision: 2 }));
    const r = await h(post({ expected_revision: 1, reason: 'abc' }, { 'x-correlation-id': 'corr-abcdef12' }), { params });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data: { echoed: 'abc' }, correlation_id: 'corr-abcdef12', revision: 2 });
  });

  it('generates a correlation id when the header is missing or unsafe', async () => {
    const h = handler({ auth: 'none' }, async () => ({ ok: true }));
    const r = await h(new Request(url, { headers: { 'x-correlation-id': 'bad id\n' } }));
    const body = await r.json();
    expect(body.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers.get('x-correlation-id')).toBe(body.correlation_id);
  });

  it('turns zod failures into 400 VALIDATION_FAILED with field_errors', async () => {
    const h = handler({ auth: 'none', body: schema }, async () => ({}));
    const r = await h(post({ expected_revision: 0, reason: 'x' }), { params });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(body.error.field_errors).sort()).toEqual(['expected_revision', 'reason']);
  });

  it('rejects malformed JSON with 400 BAD_REQUEST', async () => {
    const h = handler({ auth: 'none', body: schema }, async () => ({}));
    const r = await h(post('{not json'), { params });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('BAD_REQUEST');
  });

  it('parses query parameters with zod', async () => {
    const h = handler({ auth: 'none', query: z.object({ limit: z.coerce.number().max(10) }) }, async ({ query }) => query);
    expect(await (await h(new Request(`${url}?limit=5`))).json()).toMatchObject({ data: { limit: 5 } });
    expect((await h(new Request(`${url}?limit=50`))).status).toBe(400);
  });

  it('requires a well-formed Idempotency-Key on flagged routes', async () => {
    const h = handler({ auth: 'none', body: schema, idempotent: true, route: '/api/things/[id]/approve' }, async () => ({}));
    const r = await h(post({ expected_revision: 1, reason: 'abc' }), { params });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const r2 = await h(post({ expected_revision: 1, reason: 'abc' }, { 'idempotency-key': 'short' }), { params });
    expect(r2.status).toBe(400);
  });

  it('computes a stable request_hash = sha256(method, route template, subject, canonical body)', async () => {
    const seen: string[] = [];
    const h = handler(
      { auth: 'none', body: schema, idempotent: true, route: '/api/things/[id]/approve' },
      async ({ requestHash, idempotencyKey }) => {
        seen.push(requestHash!);
        return { idempotencyKey };
      },
    );
    const key = { 'idempotency-key': 'k-0123456789' };
    await h(post({ expected_revision: 1, reason: 'abc' }, key), { params });
    await h(post('{"reason":"abc","expected_revision":1}', key), { params }); // different key order
    await h(post({ expected_revision: 2, reason: 'abc' }, key), { params });
    expect(seen[0]).toBe(seen[1]);
    expect(seen[2]).not.toBe(seen[0]);
    expect(seen[0]).toBe(
      computeRequestHash({
        method: 'POST',
        route: '/api/things/[id]/approve',
        subjectId: '11111111-1111-5111-8111-111111111111',
        body: { reason: 'abc', expected_revision: 1 },
      }),
    );
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('request_hash differs per subject and per route', () => {
    const base = { method: 'POST', route: '/api/a/[id]', subjectId: 'x', body: { q: '1' } };
    const h0 = computeRequestHash(base);
    expect(computeRequestHash({ ...base, subjectId: 'y' })).not.toBe(h0);
    expect(computeRequestHash({ ...base, route: '/api/b/[id]' })).not.toBe(h0);
    expect(computeRequestHash({ ...base, method: 'post' })).toBe(h0);
  });

  it('maps thrown DomainErrors and pg errors to the error envelope', async () => {
    const conflict = handler({ auth: 'none' }, async () => {
      throw Object.assign(new Error('LB:REVISION_CONFLICT'), { code: 'P0001' });
    });
    const r = await conflict(new Request(url, { method: 'POST' }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toEqual({ code: 'REVISION_CONFLICT', message: 'REVISION_CONFLICT', retryable: false });

    const boom = handler({ auth: 'none' }, async () => {
      throw new Error('secret internals');
    });
    const r2 = await boom(new Request(url));
    expect(r2.status).toBe(500);
    expect(JSON.stringify(await r2.json())).not.toContain('secret');
  });

  it('hides forbidden/not-found objects as 404 on object-scoped routes', async () => {
    const h = handler({ auth: 'none', notFoundOnForbidden: true }, async () => {
      throw Object.assign(new Error('permission denied for table agreements'), { code: '42501' });
    });
    const r = await h(new Request(url));
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('NOT_FOUND');

    const plain = handler({ auth: 'none' }, async () => {
      throw new DomainError({ code: 'FORBIDDEN' });
    });
    expect((await plain(new Request(url))).status).toBe(403);
  });

  it('passes Response results through with the correlation header', async () => {
    const h = handler({ auth: 'none' }, async () => new Response('plain', { status: 202 }));
    const r = await h(new Request(url));
    expect(r.status).toBe(202);
    expect(r.headers.get('x-correlation-id')).toBeTruthy();
  });
});
