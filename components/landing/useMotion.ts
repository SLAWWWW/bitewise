'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(listener: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

/** Animation is opt-in for reduced-motion users and sleeps outside the viewport. */
export function useMotion(ref: RefObject<HTMLElement | null>) {
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(reducedMotionQuery).matches, () => true);
  const documentVisible = useSyncExternalStore(subscribeVisibility, () => !document.hidden, () => false);
  const [visible, setVisible] = useState(false);
  const [choice, setChoice] = useState<'auto' | 'play' | 'pause'>('auto');
  const enabled = choice === 'play' || (choice === 'auto' && !reduced);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return {
    enabled,
    visible,
    running: enabled && visible && documentVisible,
    pause: () => setChoice('pause'),
    toggle: () => setChoice(enabled ? 'pause' : 'play'),
  };
}
