/**
 * Signed session cookie (architecture G.4).
 *
 *   lb_session = base64url(JSON {uid, tid, iat, exp}) + "." + base64url(HMAC-SHA256)
 *
 * The cookie only identifies (user, tenant). Capabilities are always re-loaded from
 * the DB (src/security/actor.ts) and never trusted from the cookie.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'lb_session';
export { LOCALE_COOKIE } from '@/src/i18n/types';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  /** user id */
  uid: string;
  /** tenant id */
  tid: string;
  /** issued at, unix seconds */
  iat: number;
  /** expires at, unix seconds */
  exp: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function mac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function assertSecret(secret: string) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('SESSION_SECRET must be >= 32 chars');
}

export function signSession(
  ids: { uid: string; tid: string },
  opts: { secret: string; now: Date; ttlSeconds?: number },
): string {
  assertSecret(opts.secret);
  const iat = Math.floor(opts.now.getTime() / 1000);
  const payload: SessionPayload = { uid: ids.uid, tid: ids.tid, iat, exp: iat + (opts.ttlSeconds ?? SESSION_TTL_SECONDS) };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(mac(opts.secret, body))}`;
}

/** Returns the payload when the signature is valid and the token is unexpired; else null. */
export function verifySession(
  token: string | undefined | null,
  opts: { secret: string; now: Date },
): SessionPayload | null {
  if (!token || typeof token !== 'string' || token.length > 2048) return null;
  assertSecret(opts.secret);
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  const expected = mac(opts.secret, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let p: unknown;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object') return null;
  const { uid, tid, iat, exp } = p as Record<string, unknown>;
  if (typeof uid !== 'string' || !UUID_RE.test(uid)) return null;
  if (typeof tid !== 'string' || !UUID_RE.test(tid)) return null;
  if (typeof iat !== 'number' || typeof exp !== 'number' || !Number.isInteger(iat) || !Number.isInteger(exp)) return null;
  const nowS = Math.floor(opts.now.getTime() / 1000);
  if (exp <= nowS) return null;
  if (iat > nowS + 300) return null; // issued in the future (clock skew > 5 min)
  return { uid, tid, iat, exp };
}

/** Extract one cookie value from a raw Cookie header. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const v = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return undefined;
}

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
}

export function sessionCookieOptions(baseUrl: string, maxAge = SESSION_TTL_SECONDS): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: baseUrl.startsWith('https://'), maxAge };
}

/** Serialise a Set-Cookie header value. */
export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path}`, `Max-Age=${o.maxAge}`, `SameSite=Lax`];
  if (o.httpOnly) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}
