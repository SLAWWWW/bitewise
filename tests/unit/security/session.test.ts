import { describe, it, expect } from 'vitest';
import {
  readCookie,
  serializeCookie,
  sessionCookieOptions,
  signSession,
  SESSION_TTL_SECONDS,
  verifySession,
} from '@/src/security/session';

const secret = 'x'.repeat(40);
const now = new Date('2026-10-26T01:00:00Z');
const ids = { uid: '0b3c1f2e-4d5a-5b6c-8d7e-9f0a1b2c3d4e', tid: '1a2b3c4d-5e6f-5a7b-9c8d-0e1f2a3b4c5d' };

describe('session tokens (HMAC-SHA256)', () => {
  it('signs and verifies {uid, tid, iat, exp} with a 12h TTL', () => {
    const token = signSession(ids, { secret, now });
    const p = verifySession(token, { secret, now });
    expect(p).toEqual({ ...ids, iat: now.getTime() / 1000, exp: now.getTime() / 1000 + SESSION_TTL_SECONDS });
  });

  it('rejects a tampered payload or signature', () => {
    const token = signSession(ids, { secret, now });
    const [body, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), tid: ids.uid }),
    ).toString('base64url');
    expect(verifySession(`${forged}.${sig}`, { secret, now })).toBeNull();
    const flipped = sig.slice(0, -2) + (sig.endsWith('AA') ? 'AB' : 'AA');
    expect(verifySession(`${body}.${flipped}`, { secret, now })).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const token = signSession(ids, { secret, now });
    expect(verifySession(token, { secret: 'y'.repeat(40), now })).toBeNull();
  });

  it('rejects expired tokens (exactly at exp)', () => {
    const token = signSession(ids, { secret, now, ttlSeconds: 60 });
    expect(verifySession(token, { secret, now: new Date(now.getTime() + 59_000) })).not.toBeNull();
    expect(verifySession(token, { secret, now: new Date(now.getTime() + 60_000) })).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of [undefined, null, '', 'abc', 'a.b.c', '.', 'x'.repeat(3000)]) {
      expect(verifySession(bad as string, { secret, now })).toBeNull();
    }
  });

  it('rejects non-uuid ids even when correctly signed', () => {
    const token = signSession({ uid: 'admin', tid: ids.tid }, { secret, now });
    expect(verifySession(token, { secret, now })).toBeNull();
  });

  it('refuses short secrets', () => {
    expect(() => signSession(ids, { secret: 'short', now })).toThrow();
  });
});

describe('cookie helpers', () => {
  it('reads one cookie from a header', () => {
    expect(readCookie('a=1; lb_session=abc.def; lb_locale=en', 'lb_session')).toBe('abc.def');
    expect(readCookie('a=1', 'lb_session')).toBeUndefined();
    expect(readCookie(null, 'lb_session')).toBeUndefined();
  });

  it('serialises an HttpOnly SameSite=Lax cookie, Secure only on https', () => {
    expect(serializeCookie('lb_session', 'v', sessionCookieOptions('http://localhost:3000'))).toBe(
      'lb_session=v; Path=/; Max-Age=43200; SameSite=Lax; HttpOnly',
    );
    expect(serializeCookie('lb_session', 'v', sessionCookieOptions('https://x.example', 0))).toContain('; Secure');
  });
});
