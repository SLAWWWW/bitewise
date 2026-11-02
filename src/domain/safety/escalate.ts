/**
 * INV03: AI may flag additional concerns or require review; it can never loosen a
 * deterministic failure. `escalateOnly(floor, proposed)` returns the stricter verdict.
 */
export const SAFETY_VERDICTS = ['CLEARED', 'REVIEW_REQUIRED', 'REJECTED'] as const;
export type SafetyVerdict = (typeof SAFETY_VERDICTS)[number];

const RANK: Record<SafetyVerdict, number> = { CLEARED: 0, REVIEW_REQUIRED: 1, REJECTED: 2 };

export function escalateOnly(floor: SafetyVerdict, proposed: SafetyVerdict): SafetyVerdict {
  return RANK[proposed] > RANK[floor] ? proposed : floor;
}
