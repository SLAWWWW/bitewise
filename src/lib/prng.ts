/**
 * Deterministic pseudo-random streams for the seed and simulations.
 * Never use Math.random in domain logic or the seed.
 */

/** 32-bit FNV-1a over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

/** mulberry32: returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent stream per concern: mulberry32(fnv1a32(`${seed}:${label}`)). */
export function streamFor(seed: number | string, label: string): Rng {
  return mulberry32(fnv1a32(`${seed}:${label}`));
}

/** Integer in [min, max] inclusive. */
export function intBetween(rng: Rng, min: number, max: number): number {
  if (max < min) throw new RangeError('max < min');
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick one element. */
export function pick<T>(rng: Rng, xs: readonly T[]): T {
  if (xs.length === 0) throw new RangeError('empty array');
  return xs[Math.floor(rng() * xs.length)];
}

/** Fisher–Yates shuffle; returns a new array, input untouched. */
export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
