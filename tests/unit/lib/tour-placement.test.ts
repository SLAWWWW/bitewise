import { describe, expect, it } from 'vitest';
import { placePopover, type Box } from '@/components/walkthrough/placement';

const intersects = (a: Box, b: Box) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

describe('spotlight callout placement', () => {
  const cases = [
    { name: 'desktop field', viewport: { left: 0, top: 0, width: 1440, height: 900 }, anchor: { left: 300, top: 400, width: 180, height: 44 }, popover: { width: 360, height: 330 } },
    { name: 'rightmost desktop action', viewport: { left: 0, top: 0, width: 1440, height: 900 }, anchor: { left: 1240, top: 400, width: 160, height: 44 }, popover: { width: 360, height: 330 } },
    { name: 'mobile field', viewport: { left: 0, top: 0, width: 390, height: 844 }, anchor: { left: 26, top: 360, width: 338, height: 44 }, popover: { width: 358, height: 330 } },
    { name: 'mobile target near bottom', viewport: { left: 0, top: 0, width: 390, height: 844 }, anchor: { left: 20, top: 720, width: 340, height: 40 }, popover: { width: 358, height: 330 } },
    { name: 'visible viewport above a mobile keyboard', viewport: { left: 0, top: 100, width: 390, height: 400 }, anchor: { left: 20, top: 150, width: 340, height: 40 }, popover: { width: 358, height: 250 } },
  ];
  for (const { name, viewport, anchor, popover } of cases) {
    it(`keeps the explanation visible and clear of the ${name}`, () => {
      const position = placePopover(anchor, popover, viewport);
      expect(position.left).toBeGreaterThanOrEqual(viewport.left + 16);
      expect(position.top).toBeGreaterThanOrEqual(viewport.top + 16);
      expect(position.left + popover.width).toBeLessThanOrEqual(viewport.left + viewport.width - 16);
      expect(position.top + popover.height).toBeLessThanOrEqual(viewport.top + viewport.height - 16);
      expect(intersects(anchor, { ...position, ...popover })).toBe(false);
    });
  }
});
