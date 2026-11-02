import { describe, expect, it } from 'vitest';
import { deriveIdempotencyKey, isValidIdempotencyKey } from '@/src/http/idempotency';

describe('deriveIdempotencyKey', () => {
  it('fits the DB key limit (200) even for the longest valid client key', () => {
    const longest = 'k'.repeat(200);
    expect(isValidIdempotencyKey(longest)).toBe(true);
    const derived = deriveIdempotencyKey(longest, 'confirm');
    expect(derived.length).toBeLessThanOrEqual(200);
    expect(derived).toBe(deriveIdempotencyKey(longest, 'confirm'));
  });

  it('can never collide with a client-supplied key and differs per step and per key', () => {
    const d = deriveIdempotencyKey('client-key-0001', 'confirm');
    expect(isValidIdempotencyKey(d)).toBe(false);
    expect(d).not.toBe(deriveIdempotencyKey('client-key-0002', 'confirm'));
    expect(d).not.toBe(deriveIdempotencyKey('client-key-0001', 'other'));
  });
});
