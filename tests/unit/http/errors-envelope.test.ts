import { describe, it, expect } from 'vitest';
import { DomainError, mapDbError } from '@/src/db/errors';
import { errorBody, errorResponse, okResponse } from '@/src/http/envelope';
import { decodeCursor, encodeCursor, paginationQuery, toPage } from '@/src/http/pagination';

const pgErr = (code: string, message = 'x', detail?: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, detail, ...extra });

describe('mapDbError', () => {
  it('maps LB:<CODE> P0001 exceptions using the code registry', () => {
    const e = mapDbError(pgErr('P0001', 'LB:REVISION_CONFLICT'));
    expect(e).toBeInstanceOf(DomainError);
    expect([e.code, e.http, e.retryable, e.pgCode]).toEqual(['REVISION_CONFLICT', 409, false, 'P0001']);
    expect(mapDbError(pgErr('P0001', 'LB:AGREEMENT_EXPIRED')).http).toBe(422);
    expect(mapDbError(pgErr('P0001', 'LB:STOCK_UNAVAILABLE')).http).toBe(409);
  });

  it('reads message, field_errors, http and retryable from the DETAIL json', () => {
    const e = mapDbError(
      pgErr(
        'P0001',
        'LB:QTY_INCREMENT_VIOLATION',
        JSON.stringify({ message: 'Must be a multiple of 10', field_errors: { quantity: 'Not a multiple of 10' } }),
      ),
    );
    expect(e.message).toBe('Must be a multiple of 10');
    expect(e.field_errors).toEqual({ quantity: ['Not a multiple of 10'] });
    const custom = mapDbError(pgErr('P0001', 'LB:SOMETHING_NEW', JSON.stringify({ http: 404 })));
    expect([custom.code, custom.http]).toEqual(['SOMETHING_NEW', 404]);
    const unsafe = mapDbError(pgErr('P0001', 'LB:SOMETHING_NEW', JSON.stringify({ http: 200 })));
    expect(unsafe.http).toBe(422);
  });

  it('maps native pg codes', () => {
    expect([mapDbError(pgErr('23505')).code, mapDbError(pgErr('23505')).http]).toEqual(['CONFLICT', 409]);
    expect([mapDbError(pgErr('42501')).code, mapDbError(pgErr('42501')).http]).toEqual(['FORBIDDEN', 403]);
    expect(mapDbError(pgErr('23514')).http).toBe(422);
    expect(mapDbError(pgErr('23503')).http).toBe(422);
    expect(mapDbError(pgErr('22P02')).http).toBe(400);
    const ser = mapDbError(pgErr('40001'));
    expect([ser.code, ser.http, ser.retryable]).toEqual(['SERIALIZATION_FAILURE', 409, true]);
    expect(mapDbError(pgErr('ECONNREFUSED')).http).toBe(503);
    expect(mapDbError(pgErr('XX000')).http).toBe(500);
  });

  it('passes DomainErrors through and wraps unknown throwables as INTERNAL', () => {
    const d = new DomainError({ code: 'NOT_FOUND' });
    expect(mapDbError(d)).toBe(d);
    expect(mapDbError(new TypeError('boom')).code).toBe('INTERNAL');
  });
});

describe('envelope', () => {
  it('wraps success as {data, correlation_id, revision?}', async () => {
    const r = okResponse({ id: 'a', qty: 40500n }, 'corr-1234', { revision: 3 });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-correlation-id')).toBe('corr-1234');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ data: { id: 'a', qty: '40500' }, correlation_id: 'corr-1234', revision: 3 });
  });

  it('wraps errors as {error:{code,message,retryable,field_errors?}, correlation_id}', async () => {
    const err = new DomainError({ code: 'VALIDATION_FAILED', message: 'bad', field_errors: { q: ['x'] } });
    const r = errorResponse(err, 'corr-1234');
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'bad', retryable: false, field_errors: { q: ['x'] } },
      correlation_id: 'corr-1234',
    });
  });

  it('never leaks internal messages for 5xx', () => {
    const body = errorBody(new DomainError({ code: 'INTERNAL', message: 'relation "secret" does not exist' }), 'c');
    expect(body.error.message).toBe('Internal error');
    expect(errorBody(new DomainError({ code: 'DB_UNAVAILABLE', message: 'conn refused 10.0.0.1' }), 'c').error).toEqual({
      code: 'DB_UNAVAILABLE',
      message: 'Service temporarily unavailable',
      retryable: true,
    });
  });
});

describe('pagination cursors', () => {
  it('round-trips [sortKey, id] opaquely', () => {
    const c = encodeCursor('FLO-0042', 'b0f5c8a4-2b1e-5c9d-8e7f-0a1b2c3d4e5f');
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual(['FLO-0042', 'b0f5c8a4-2b1e-5c9d-8e7f-0a1b2c3d4e5f']);
    expect(decodeCursor(encodeCursor(new Date('2026-10-26T01:00:00Z'), 'x'))).toEqual(['2026-10-26T01:00:00.000Z', 'x']);
  });

  it('rejects garbage with a 400', () => {
    for (const bad of ['!!', Buffer.from('{"a":1}').toString('base64url'), Buffer.from('[1]').toString('base64url')]) {
      try {
        decodeCursor(bad);
        expect.unreachable();
      } catch (e) {
        expect((e as DomainError).http).toBe(400);
      }
    }
  });

  it('trims LIMIT+1 rows into a page with next_cursor', () => {
    const rows = [1, 2, 3].map((n) => ({ code: `C${n}`, id: `id${n}` }));
    expect(toPage(rows, 2, (r) => [r.code, r.id])).toEqual({ items: rows.slice(0, 2), next_cursor: encodeCursor('C2', 'id2') });
    expect(toPage(rows, 5, (r) => [r.code, r.id]).next_cursor).toBeNull();
  });

  it('validates limit', () => {
    expect(paginationQuery.parse({}).limit).toBe(50);
    expect(paginationQuery.safeParse({ limit: '500' }).success).toBe(false);
  });
});
