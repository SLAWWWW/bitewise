'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * A visible "ⓘ" trigger with a click-to-open popover — not the native `title`
 * attribute, which has no visual affordance (nothing tells you it's there),
 * a multi-second hover delay, and doesn't work at all on touch devices. This
 * works identically on click (desktop) and tap (mobile), and is always
 * discoverable since the icon itself signals "there's more information here."
 */
export function InfoTooltip({ text, size = 11 }: { text: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="More info"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: open ? 'var(--accent)' : 'var(--text-tertiary)',
          background: 'none',
          border: 'none',
          padding: 2,
          marginLeft: 3,
          lineHeight: 0,
        }}
      >
        <Info size={size} />
      </button>
      {open && (
        <div
          role="tooltip"
          className="rise-in"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 8,
            width: 240,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
            zIndex: 60,
            fontSize: 11.5,
            fontWeight: 400,
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            textAlign: 'left',
            textTransform: 'none',
            letterSpacing: 'normal',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
