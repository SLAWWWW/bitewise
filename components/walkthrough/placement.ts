export interface Box { left: number; top: number; width: number; height: number }
export interface PopoverPosition { left: number; top: number; side: 'top' | 'bottom' | 'left' | 'right'; arrow: number }
const margin = 16;
const gap = 16;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)));

/** Place a callout beside a target while keeping it within the visible viewport. */
export function placePopover(anchor: Box, popover: { width: number; height: number }, viewport: Box): PopoverPosition {
  const minX = viewport.left + margin;
  const minY = viewport.top + margin;
  const maxX = viewport.left + viewport.width - popover.width - margin;
  const maxY = viewport.top + viewport.height - popover.height - margin;
  const centeredX = clamp(anchor.left + anchor.width / 2 - popover.width / 2, minX, maxX);
  const centeredY = clamp(anchor.top + anchor.height / 2 - popover.height / 2, minY, maxY);
  if (viewport.width >= 768 && anchor.left + anchor.width + gap + popover.width <= viewport.left + viewport.width - margin) {
    return { left: anchor.left + anchor.width + gap, top: centeredY, side: 'left', arrow: clamp(anchor.top + anchor.height / 2 - centeredY, 24, popover.height - 24) };
  }
  if (viewport.width >= 768 && anchor.left - gap - popover.width >= minX) {
    return { left: anchor.left - gap - popover.width, top: centeredY, side: 'right', arrow: clamp(anchor.top + anchor.height / 2 - centeredY, 24, popover.height - 24) };
  }
  const below = anchor.top + anchor.height + gap;
  if (below <= maxY) return { left: centeredX, top: below, side: 'top', arrow: clamp(anchor.left + anchor.width / 2 - centeredX, 24, popover.width - 24) };
  return { left: centeredX, top: clamp(anchor.top - gap - popover.height, minY, maxY), side: 'bottom', arrow: clamp(anchor.left + anchor.width / 2 - centeredX, 24, popover.width - 24) };
}
