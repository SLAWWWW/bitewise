import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json';

/** Lowercase hex SHA-256 of a UTF-8 string or bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** sha256 of canonical JSON (facts_hash, request bodies). */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
