/**
 * Pure display logic for the tenant clock pill (UI only, not domain time).
 *
 * The server value (tenant_now() at render) is the source of truth. A locally advanced
 * tick is only shown while it was derived from the *current* server value, so a new clock
 * prop after router.refresh() (advance clock / reset demo / mode toggle) is displayed
 * immediately instead of a stale locally held instant.
 */
export interface ClockTick {
  /** The server `now` the tick was advanced from. */
  base: string;
  /** Mode the tick was advanced under. */
  mode: string;
  /** Locally advanced ISO instant. */
  at: string;
}

export function displayedClockInstant(
  clock: { now: string; mode: string } | null | undefined,
  tick: ClockTick | null,
): string | null {
  if (!clock) return null;
  if (clock.mode === 'FROZEN') return clock.now;
  if (tick && tick.base === clock.now && tick.mode === clock.mode) return tick.at;
  return clock.now;
}
