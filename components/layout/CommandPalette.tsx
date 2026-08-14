'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Inbox,
  Bot,
  Users,
  Warehouse,
  HandHeart,
  Utensils,
  Truck,
  HeartHandshake,
  Search,
} from 'lucide-react';

export const PALETTE_EVENT = 'bitewise:open-palette';

/** Opens the palette from anywhere without simulating a keystroke. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(PALETTE_EVENT));
}

const COMMANDS = [
  { label: 'Network Overview', hint: 'Dashboard, map, fairness', href: '/orchestrator', icon: LayoutDashboard },
  { label: 'Pending Approvals', hint: 'Approve or reject donations', href: '/approvals', icon: Inbox },
  { label: 'Agent Decisions', hint: 'Full AI decision transcripts', href: '/agents', icon: Bot },
  { label: 'Fleet & Logistics', hint: 'Vehicles, runs, cross-branch cover', href: '/logistics', icon: Truck },
  { label: 'Storage Management', hint: 'Zones, temperatures, racks', href: '/storage', icon: Warehouse },
  { label: 'Partner Dispatch', hint: 'Escalated food, optimised routes', href: '/dispatch', icon: HeartHandshake },
  { label: 'Donor Relationships', hint: 'Every contributing business', href: '/donors', icon: Users },
  { label: 'Browse Food (public)', hint: 'What recipients see', href: '/recipient', icon: Utensils },
  { label: 'Donate Food (public)', hint: 'Donor submission form', href: '/donate', icon: HandHeart },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)
    );
  }, [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setIndex(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  // Global ⌘K / Ctrl+K, plus an explicit event so UI buttons can open it
  // without faking a keystroke.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onRequest() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onRequest);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, onRequest);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // Clamped at render rather than synced via an effect — the stored index can
  // outlive a shrinking result list, and deriving it avoids a cascading render.
  const activeIndex = Math.min(index, Math.max(0, results.length - 1));

  return (
    <div className="palette-scrim" onClick={close} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4" style={{ borderBottom: '0.5px solid var(--border-default)' }}>
          <Search size={15} color="var(--text-tertiary)" aria-hidden="true" />
          <input
            ref={inputRef}
            id="command-palette-input"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="command-palette-listbox"
            aria-expanded={results.length > 0}
            aria-activedescendant={
              results[activeIndex] ? `palette-option-${activeIndex}` : undefined
            }
            aria-label="Search pages"
            className="palette-input"
            style={{ borderBottom: 'none', paddingLeft: 0 }}
            placeholder="Jump to a page…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((activeIndex + 1) % Math.max(1, results.length));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((activeIndex - 1 + results.length) % Math.max(1, results.length));
              }
              if (e.key === 'Enter' && results[activeIndex]) {
                go(results[activeIndex].href);
              }
            }}
          />
        </div>

        <div
          id="command-palette-listbox"
          role="listbox"
          aria-label="Pages"
          className="flex flex-col py-1.5"
          style={{ maxHeight: 320, overflowY: 'auto' }}
        >
          {results.length === 0 && (
            <span className="text-caption px-4 py-3" role="status">No matching pages.</span>
          )}
          {results.map((c, i) => {
            const Icon = c.icon;
            return (
              <button
                key={c.href}
                id={`palette-option-${i}`}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                className={`palette-item ${i === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(c.href)}
              >
                <Icon size={15} style={{ flexShrink: 0 }} aria-hidden="true" />
                <span style={{ minWidth: 0 }}>{c.label}</span>
                <span className="text-caption ml-auto truncate" style={{ fontSize: 11 }}>
                  {c.hint}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="flex items-center gap-3 px-4 py-2.5 text-caption"
          style={{ borderTop: '0.5px solid var(--border-default)', fontSize: 11 }}
        >
          <span className="flex items-center gap-1">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span className="flex items-center gap-1">
            <span className="kbd">↵</span> open
          </span>
          <span className="flex items-center gap-1">
            <span className="kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
