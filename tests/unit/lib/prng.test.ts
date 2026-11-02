import { describe, it, expect } from 'vitest';
import { fnv1a32, intBetween, mulberry32, shuffle, streamFor } from '@/src/lib/prng';

describe('fnv1a32', () => {
  it('matches the published FNV-1a 32-bit vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
});

describe('mulberry32 / streamFor', () => {
  it('is deterministic for a seed and stays in [0,1)', () => {
    const a = mulberry32(20261026);
    const b = mulberry32(20261026);
    const xs = Array.from({ length: 1000 }, () => a());
    const ys = Array.from({ length: 1000 }, () => b());
    expect(xs).toEqual(ys);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('pins the first outputs (changing the generator breaks the seed manifest)', () => {
    const r = mulberry32(1);
    expect([r(), r(), r()].map((x) => x.toFixed(10))).toEqual(['0.6270739406', '0.0027357212', '0.5274470400']);
  });

  it('gives independent streams per label', () => {
    const area = streamFor(20261026, 'flo.area');
    const type = streamFor(20261026, 'flo.type');
    const area2 = streamFor(20261026, 'flo.area');
    const a = [area(), area(), area()];
    expect([area2(), area2(), area2()]).toEqual(a);
    expect([type(), type(), type()]).not.toEqual(a);
  });

  it('intBetween covers its inclusive range', () => {
    const r = mulberry32(7);
    const seen = new Set(Array.from({ length: 500 }, () => intBetween(r, 1, 3)));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });
});

describe('shuffle (Fisher–Yates)', () => {
  it('is a deterministic permutation that leaves the input untouched', () => {
    const input = Array.from({ length: 200 }, (_, i) => i);
    const s1 = shuffle(input, streamFor(20261026, 'x'));
    const s2 = shuffle(input, streamFor(20261026, 'x'));
    expect(s1).toEqual(s2);
    expect(s1).not.toEqual(input);
    expect([...s1].sort((a, b) => a - b)).toEqual(input);
    expect(input[0]).toBe(0);
  });
});
