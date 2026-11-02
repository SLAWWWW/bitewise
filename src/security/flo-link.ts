/**
 * Scoped FLO access links (/f/[token]). The token is 32 random bytes (base64url);
 * only its sha256 hex is stored in flo_access_links.token_hash.
 */
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '@/src/lib/hash';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function createToken(): { token: string; token_hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, token_hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Cheap shape check before any DB lookup. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}
