/**
 * Idempotency-Key handling and request_hash (architecture G.4):
 *   request_hash = sha256(method + "\n" + routeTemplate + "\n" + subjectId + "\n" + canonicalJson(body))
 */
import { canonicalJson } from '@/src/lib/canonical-json';
import { sha256Hex } from '@/src/lib/hash';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

export function isValidIdempotencyKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && KEY_RE.test(key);
}

/**
 * Key for a second command step executed under one client request (e.g. PROPOSE+confirm).
 * Fixed length (step + '#' + 64 hex) so it always fits the DB's 200-char limit no matter how
 * long the client key is, and contains '#', which KEY_RE rejects, so it can never collide
 * with a client-supplied key.
 */
export function deriveIdempotencyKey(key: string, step: string): string {
  return `${step}#${sha256Hex(key)}`;
}

export function computeRequestHash(input: {
  method: string;
  route: string;
  subjectId?: string | null;
  body?: unknown;
}): string {
  const body = input.body === undefined ? 'null' : canonicalJson(input.body);
  return sha256Hex(`${input.method.toUpperCase()}\n${input.route}\n${input.subjectId ?? ''}\n${body}`);
}
