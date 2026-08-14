/**
 * Jain's Fairness Index across Willing Hearts branches.
 * 1.0 = perfectly even load distribution relative to capacity; approaches 1/n as load concentrates
 * in a single branch.
 */
export function calculateJainFairnessIndex(
  branches: { current_load_kg: number; capacity_kg: number }[]
): number {
  const n = branches.length;
  if (n === 0) return 1;

  const ratios = branches.map((b) => (b.capacity_kg > 0 ? b.current_load_kg / b.capacity_kg : 0));
  const sumR = ratios.reduce((acc, r) => acc + r, 0);
  const sumR2 = ratios.reduce((acc, r) => acc + r * r, 0);

  if (sumR2 === 0) return 1;
  return (sumR * sumR) / (n * sumR2);
}
