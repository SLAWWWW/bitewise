/**
 * RFC 4122 / 9562 UUID version 5 (SHA-1, name-based) on node:crypto.
 * Deterministic IDs for the seed: `uuidv5(`${entity}:${naturalKey}`, tenantNs)`.
 */
import { createHash } from 'node:crypto';

export const NS_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
export const NS_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
/** = uuidv5('https://lumbung.example.invalid/', NS_URL). Fixed forever. */
export const LUMBUNG_ROOT_NS = '931baccf-2eaf-5601-8096-3f07c5ae0ead';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function uuidToBytes(uuid: string): Buffer {
  if (!isUuid(uuid)) throw new TypeError(`Invalid namespace UUID: ${uuid}`);
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function uuidv5(name: string, namespace: string): string {
  const hash = createHash('sha1').update(uuidToBytes(namespace)).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(b);
}

/** Namespace for all deterministic IDs of one tenant. */
export function tenantNamespace(slug: string): string {
  return uuidv5(`lumbung:tenant:${slug}`, LUMBUNG_ROOT_NS);
}

/** Deterministic entity id, e.g. entityId(ns, 'flo', 'FLO-0042'). */
export function entityId(tenantNs: string, entity: string, naturalKey: string): string {
  return uuidv5(`${entity}:${naturalKey}`, tenantNs);
}
