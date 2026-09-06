'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Animates a stat from 0 to its real value once scrolled into view. Only
 * animates the numeric part — `prefix`/`suffix` carry whatever isn't a plain
 * count (e.g. "23–48M" is passed as a literal string, not this component;
 * this is for the single-number stats like "23.36").
 */
export function CountUp({
  to,
  decimals = 0,
  duration = 1100,
  suffix = '',
}: {
  to: number;
  decimals?: number;
  duration?: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          function tick(now: number) {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setValue(to * eased);
            if (t < 1) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref} className="tnum">
      {value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
