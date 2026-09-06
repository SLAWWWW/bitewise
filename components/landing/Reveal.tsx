'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Fades/slides a section up the moment it scrolls into view — the source of
 * the "dynamic" feel that colour would otherwise carry on this monochrome
 * page. Pure CSS transition driven by one class toggle; the observer just
 * decides *when*, never *how*, so `prefers-reduced-motion` (handled in
 * globals.css) still works without this component knowing about it.
 */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`lp-reveal${visible ? ' is-visible' : ''}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
