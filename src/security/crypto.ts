/**
 * Contact address encryption at rest (AES-256-GCM, key = CONTACT_ENC_KEY, 32 bytes
 * base64). Layout: 0x01 | iv(12) | tag(16) | ciphertext. Optional AAD binds the
 * ciphertext to e.g. a tenant id so rows cannot be swapped across tenants.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '@/src/config/env';

const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;

export function decodeKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('CONTACT_ENC_KEY must decode to 32 bytes');
  return key;
}

function defaultKey(): Buffer {
  return decodeKey(getEnv().CONTACT_ENC_KEY);
}

export function encryptWithKey(plain: string, key: Buffer, aad?: string, iv: Buffer = randomBytes(IV_LEN)): Buffer {
  if (iv.length !== IV_LEN) throw new Error('iv must be 12 bytes');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decryptWithKey(blob: Buffer | Uint8Array, key: Buffer, aad?: string): string {
  const buf = Buffer.from(blob);
  if (buf.length < 1 + IV_LEN + TAG_LEN || buf[0] !== VERSION) throw new Error('Unsupported ciphertext');
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = buf.subarray(1 + IV_LEN + TAG_LEN);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  if (aad) d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/** Encrypt with CONTACT_ENC_KEY from the environment (or an explicit key). */
export function encryptContact(plain: string, opts: { aad?: string; key?: Buffer } = {}): Buffer {
  return encryptWithKey(plain, opts.key ?? defaultKey(), opts.aad);
}

export function decryptContact(blob: Buffer | Uint8Array, opts: { aad?: string; key?: Buffer } = {}): string {
  return decryptWithKey(blob, opts.key ?? defaultKey(), opts.aad);
}

/**
 * Masked hint for display/logs:
 *   sim:flo:0042            → sim:flo:00**
 *   flo0042@example.invalid → fl*****@example.invalid
 *   +6281234567890          → +62*******890
 */
export function maskAddress(addr: string): string {
  const a = addr.trim();
  if (a.startsWith('sim:')) {
    const keep = Math.max(a.lastIndexOf(':') + 1, a.length - 2);
    return a.slice(0, keep) + '*'.repeat(a.length - keep);
  }
  const at = a.indexOf('@');
  if (at > 0) {
    const local = a.slice(0, at);
    const shown = local.slice(0, Math.min(2, local.length));
    return `${shown}${'*'.repeat(Math.max(1, local.length - shown.length))}${a.slice(at)}`;
  }
  if (a.length <= 4) return '*'.repeat(a.length);
  const head = a.startsWith('+') ? 3 : 2;
  const tail = 3;
  if (a.length <= head + tail) return a.slice(0, 1) + '*'.repeat(a.length - 1);
  return a.slice(0, head) + '*'.repeat(a.length - head - tail) + a.slice(-tail);
}
