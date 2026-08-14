import { describe, it, expect } from 'vitest';
import { deterministicWindow, clampMinutes } from '@/lib/agents/pickup-window-agent';

describe('deterministicWindow', () => {
  it('gives a short window for a critical item (<6h remaining)', () => {
    const w = deterministicWindow({ hoursRemaining: 3, foodType: 'cooked', storageType: 'cold' });
    expect(w.used_ai).toBe(false);
    expect(w.minutes).toBe(30);
  });

  it('gives a longer window for a stable item (>=72h remaining)', () => {
    const w = deterministicWindow({ hoursRemaining: 100, foodType: 'canned', storageType: 'ambient' });
    expect(w.minutes).toBe(360);
  });

  it('never exceeds half the remaining shelf life, even for a stable item', () => {
    // 72h tier base is 360 minutes (6h), but only 1h remains — half of that is 30 min.
    const w = deterministicWindow({ hoursRemaining: 1, foodType: 'bread', storageType: 'ambient' });
    expect(w.minutes).toBeLessThanOrEqual(30);
  });

  it('never goes below the 10-minute floor even for an almost-expired item', () => {
    const w = deterministicWindow({ hoursRemaining: 0.05, foodType: 'dairy', storageType: 'cold' });
    expect(w.minutes).toBeGreaterThanOrEqual(10);
  });

  it('caps at 480 minutes even for a food item with an enormous remaining window', () => {
    const w = deterministicWindow({ hoursRemaining: 8760, foodType: 'canned', storageType: 'ambient' });
    expect(w.minutes).toBeLessThanOrEqual(480);
  });
});

describe('clampMinutes', () => {
  it('clamps a too-generous AI suggestion down to half the remaining shelf life', () => {
    expect(clampMinutes(1000, 2)).toBeLessThanOrEqual(60);
  });

  it('clamps a too-aggressive AI suggestion up to the 10-minute floor', () => {
    expect(clampMinutes(1, 24)).toBe(10);
  });

  it('leaves a reasonable AI suggestion untouched', () => {
    expect(clampMinutes(45, 24)).toBe(45);
  });
});
