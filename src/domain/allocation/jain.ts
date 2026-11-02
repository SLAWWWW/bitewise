/**
 * Jain's fairness index — diagnostic only (PRD §8 "Network fairness diagnostics").
 * Never feeds back into weights. x_i are capped demand coverages in [0, 1].
 *
 *   J = (Σx)² / (n · Σx²)   ∈ [1/n, 1]
 */
export type JainResult =
  | { status: 'OK'; index: number; n: number }
  | { status: 'NO_DISTRIBUTION'; n: number }
  | { status: 'INSUFFICIENT_COHORT'; n: number };

/** Raw index; returns null when undefined (empty cohort or all zeros). */
export function jainIndex(xs: readonly number[]): number | null {
  const n = xs.length;
  if (n === 0) return null;
  let sum = 0;
  let sumSq = 0;
  for (const x of xs) {
    if (!Number.isFinite(x) || x < 0) throw new RangeError('jainIndex: values must be finite and >= 0');
    sum += x;
    sumSq += x * x;
  }
  if (sumSq === 0) return null;
  return (sum * sum) / (n * sumSq);
}

/** Cohort diagnostic: fewer than 2 partners → INSUFFICIENT_COHORT; all zero → NO_DISTRIBUTION. */
export function jainDiagnostic(coverages: readonly number[]): JainResult {
  const capped = coverages.map((c) => Math.min(1, Math.max(0, c)));
  const n = capped.length;
  if (n < 2) return { status: 'INSUFFICIENT_COHORT', n };
  const j = jainIndex(capped);
  if (j === null) return { status: 'NO_DISTRIBUTION', n };
  return { status: 'OK', index: j, n };
}
