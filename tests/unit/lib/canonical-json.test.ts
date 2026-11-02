import { describe, it, expect } from 'vitest';
import { canonicalJson } from '@/src/lib/canonical-json';
import { hashCanonical, sha256Hex } from '@/src/lib/hash';

describe('canonicalJson', () => {
  it('sorts keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it('is independent of insertion order', () => {
    const x = { qty: '40', unit: 'portion', lines: [{ z: 1, y: 2 }] };
    const y = { lines: [{ y: 2, z: 1 }], unit: 'portion', qty: '40' };
    expect(canonicalJson(x)).toBe(canonicalJson(y));
    expect(hashCanonical(x)).toBe(hashCanonical(y));
  });

  it('drops undefined members, serialises bigint/Date as strings, normalises -0', () => {
    expect(canonicalJson({ a: undefined, b: 40500n, c: new Date('2026-10-26T01:00:00Z'), d: -0 })).toBe(
      '{"b":"40500","c":"2026-10-26T01:00:00.000Z","d":0}',
    );
  });

  it('refuses non-deterministic values', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => canonicalJson(cyc)).toThrow(TypeError);
  });

  it('escapes unicode the same way as JSON.stringify', () => {
    expect(canonicalJson({ nama: 'Roti "Manis" é' })).toBe(JSON.stringify({ nama: 'Roti "Manis" é' }));
  });
});

describe('sha256Hex', () => {
  it('matches the known vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
