import { describe, it, expect } from 'vitest';
import { escalateOnly } from '@/src/domain/safety/escalate';

describe('escalateOnly (INV03)', () => {
  it('lets AI escalate CLEARED to REVIEW_REQUIRED and REVIEW_REQUIRED to REJECTED', () => {
    expect(escalateOnly('CLEARED', 'REVIEW_REQUIRED')).toBe('REVIEW_REQUIRED');
    expect(escalateOnly('REVIEW_REQUIRED', 'REJECTED')).toBe('REJECTED');
  });

  it('never lets AI soften a deterministic verdict', () => {
    expect(escalateOnly('REJECTED', 'CLEARED')).toBe('REJECTED');
    expect(escalateOnly('REVIEW_REQUIRED', 'CLEARED')).toBe('REVIEW_REQUIRED');
  });

  it('keeps the floor when AI agrees', () => {
    expect(escalateOnly('CLEARED', 'CLEARED')).toBe('CLEARED');
  });
});
