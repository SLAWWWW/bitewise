/**
 * Display-only recalibrations of the real branch-matching scores
 * (lib/algorithms/matching.ts) — used ONLY for how numbers are shown to
 * staff, never for the actual routing decision. That decision already runs
 * on the real formulas and is correct; the problem this file solves is
 * legibility: the real formulas produce numbers that don't read the way a
 * human expects "higher is better" to feel.
 *
 * Concretely: proximity_score = 1 ÷ (1 + distance_km × 10) decays so fast
 * that even a branch 1km away — genuinely close — scores 0.09 (9%), which
 * reads as "far" to anyone who doesn't know the formula. And total_score
 * (the weighted sum of proximity + fairness + stock-safety) rarely exceeds
 * ~0.7 even for a clearly-best candidate, since proximity is so often near
 * zero — so a winning match displays as "0.64", which looks mediocre next
 * to sibling scores that individually hit 100%.
 */

/** A friendlier "how close is this" read from a raw distance — 100% at
 *  0km, decaying gradually rather than collapsing to single digits by 1km.
 *  Calibrated so branches within Singapore's typical few-km spacing still
 *  read as meaningfully close, not as "far" the way the raw routing
 *  formula's steeper curve would show them. */
export function closenessPercent(distanceKm: number): number {
  return Math.round(100 / (1 + distanceKm * 0.15));
}

/** Recalibrates total_score onto a 0-100 "higher is better" scale that
 *  actually reaches the top of its range for a genuinely strong match,
 *  instead of the raw weighted sum's realistic ceiling around 0.7. */
export function fitScore(totalScore: number): number {
  const REALISTIC_CEILING = 0.7;
  return Math.round(Math.min(1, totalScore / REALISTIC_CEILING) * 100);
}
