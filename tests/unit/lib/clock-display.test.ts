import { describe, expect, it } from 'vitest';
import { displayedClockInstant } from '@/components/layout/clock-display';

const T = '2026-10-26T01:00:00.000Z';
const T2 = '2026-10-26T03:00:00.000Z';

describe('displayedClockInstant (clock pill follows refreshed server props)', () => {
  it('FROZEN always shows the server value, including after an advance', () => {
    expect(displayedClockInstant({ now: T, mode: 'FROZEN' }, null)).toBe(T);
    // router.refresh() after advance-clock passes a new prop; it must show at once.
    expect(displayedClockInstant({ now: T2, mode: 'FROZEN' }, null)).toBe(T2);
  });

  it('TICKING shows the local tick only while it derives from the current server value', () => {
    const tick = { base: T, mode: 'TICKING', at: '2026-10-26T01:00:15.000Z' };
    expect(displayedClockInstant({ now: T, mode: 'TICKING' }, tick)).toBe(tick.at);
    // New server value (reset / advance): the stale tick is ignored.
    expect(displayedClockInstant({ now: T2, mode: 'TICKING' }, tick)).toBe(T2);
    // Mode toggled to FROZEN at the same instant: show the server value.
    expect(displayedClockInstant({ now: T, mode: 'FROZEN' }, tick)).toBe(T);
  });

  it('no clock → null', () => {
    expect(displayedClockInstant(null, null)).toBeNull();
  });
});
