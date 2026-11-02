'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { placePopover, type Box, type PopoverPosition } from './placement';
import type { TourStep } from './steps';

const descriptionId = 'tour-description';
export interface SpotlightGeometry {
  key: string;
  anchor: Box | null;
  position: PopoverPosition;
  missing: boolean;
  viewport: Box;
  maxHeight: number;
}

function visibleElement(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden') return element;
    }
  }
  return null;
}

export function useSpotlight(step: TourStep | undefined, onPage: boolean) {
  const [geometry, setGeometry] = useState<SpotlightGeometry | null>(null);
  const [popover, setPopover] = useState<HTMLElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const lastScrolled = useRef('');
  const reveal = useCallback(() => {
    targetRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    targetRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!step || !onPage) { lastScrolled.current = ''; return; }
    let frame = 0;
    let restore: (() => void) | undefined;
    const resize = new ResizeObserver(schedule);
    function attach(element: HTMLElement) {
      if (targetRef.current === element) return;
      restore?.();
      targetRef.current = element;
      const originalTabindex = element.getAttribute('tabindex');
      const descriptions = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      element.setAttribute('aria-describedby', [...new Set([...descriptions, descriptionId])].join(' '));
      element.setAttribute('data-tour-active', 'true');
      if (!element.matches('a[href],button,input,select,textarea,[tabindex]')) element.setAttribute('tabindex', '-1');
      resize.observe(element);
      restore = () => {
        resize.unobserve(element);
        element.removeAttribute('data-tour-active');
        const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== descriptionId);
        if (ids.length) element.setAttribute('aria-describedby', ids.join(' '));
        else element.removeAttribute('aria-describedby');
        if (originalTabindex === null) element.removeAttribute('tabindex');
        else element.setAttribute('tabindex', originalTabindex);
      };
    }
    function measure() {
      const found = visibleElement(step!.selectors);
      const element = found ?? document.querySelector<HTMLElement>('#main h1');
      if (!element) return;
      attach(element);
      if (lastScrolled.current !== step!.id) {
        lastScrolled.current = step!.id;
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      const visual = window.visualViewport;
      const viewport: Box = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? innerWidth, height: visual?.height ?? innerHeight };
      const rect = element.getBoundingClientRect();
      const inView = rect.bottom > viewport.top + 56 && rect.top < viewport.top + viewport.height && rect.right > viewport.left && rect.left < viewport.left + viewport.width;
      const left = Math.max(viewport.left + 4, rect.left - 6);
      const top = Math.max(viewport.top + 4, rect.top - 6);
      const right = Math.min(viewport.left + viewport.width - 4, rect.right + 6);
      const bottom = Math.min(viewport.top + viewport.height - 4, rect.bottom + 6);
      const anchor: Box | null = inView ? { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) } : null;
      const width = Math.min(360, viewport.width - 32);
      let maxHeight = viewport.height - 32;
      if (anchor && viewport.width < 768) {
        const below = viewport.top + viewport.height - 32 - anchor.top - anchor.height;
        const above = anchor.top - viewport.top - 32;
        const available = Math.max(below, above);
        if (available >= 160) maxHeight = Math.min(maxHeight, available);
      }
      const height = Math.min(popover?.getBoundingClientRect().height ?? 330, maxHeight);
      const position = anchor ? placePopover(anchor, { width, height }, viewport) : { left: viewport.left + (viewport.width - width) / 2, top: viewport.top + viewport.height - height - 16, side: 'bottom' as const, arrow: 0 };
      const next: SpotlightGeometry = { key: step!.id, anchor, position, missing: !found, viewport, maxHeight };
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }
    const mutations = new MutationObserver(schedule);
    const main = document.querySelector('#main');
    if (main) mutations.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'hidden'] });
    if (popover) resize.observe(popover);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      restore?.();
      targetRef.current = null;
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [step, onPage, popover]);

  return { geometry: onPage && geometry?.key === step?.id ? geometry : null, setPopover, reveal };
}
