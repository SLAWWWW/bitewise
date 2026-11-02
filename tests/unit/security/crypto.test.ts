import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { decodeKey, decryptContact, decryptWithKey, encryptContact, encryptWithKey, maskAddress } from '@/src/security/crypto';
import { createToken, hashToken, isWellFormedToken } from '@/src/security/flo-link';
import { sha256Hex } from '@/src/lib/hash';

const key = randomBytes(32);

describe('contact encryption (AES-256-GCM)', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptWithKey('sim:flo:0042', key);
    const b = encryptWithKey('sim:flo:0042', key);
    expect(a.equals(b)).toBe(false);
    expect(decryptWithKey(a, key)).toBe('sim:flo:0042');
    expect(a[0]).toBe(1);
  });

  it('detects tampering', () => {
    const blob = encryptWithKey('flo0042@example.invalid', key);
    blob[blob.length - 1] ^= 0x01;
    expect(() => decryptWithKey(blob, key)).toThrow();
  });

  it('binds ciphertext to its AAD (e.g. tenant id)', () => {
    const blob = encryptWithKey('sim:flo:0042', key, 'tenant-a');
    expect(decryptWithKey(blob, key, 'tenant-a')).toBe('sim:flo:0042');
    expect(() => decryptWithKey(blob, key, 'tenant-b')).toThrow();
  });

  it('fails with the wrong key and validates key length', () => {
    const blob = encryptWithKey('x', key);
    expect(() => decryptWithKey(blob, randomBytes(32))).toThrow();
    expect(() => decodeKey(Buffer.alloc(16).toString('base64'))).toThrow();
  });

  it('uses CONTACT_ENC_KEY from the environment by default (dev key in TEST)', () => {
    const blob = encryptContact('sim:flo:0001');
    expect(decryptContact(blob)).toBe('sim:flo:0001');
  });
});

describe('maskAddress', () => {
  it('masks simulated, email and phone addresses', () => {
    expect(maskAddress('sim:flo:0042')).toBe('sim:flo:00**');
    expect(maskAddress('flo0042@example.invalid')).toBe('fl*****@example.invalid');
    expect(maskAddress('+6281234567890')).toBe('+62********890');
    expect(maskAddress('abc')).toBe('***');
  });
});

describe('FLO link tokens', () => {
  it('creates 32-byte base64url tokens and stores only the sha256', () => {
    const { token, token_hash } = createToken();
    expect(isWellFormedToken(token)).toBe(true);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token_hash).toBe(sha256Hex(token));
    expect(hashToken(token)).toBe(token_hash);
    expect(token_hash).not.toContain(token);
  });

  it('rejects malformed tokens before any lookup', () => {
    expect(isWellFormedToken('../etc/passwd')).toBe(false);
    expect(isWellFormedToken('a'.repeat(42))).toBe(false);
  });
});
