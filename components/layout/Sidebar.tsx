'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Warehouse,
  ArrowLeftRight,
  Bot,
  Inbox,
  Truck,
  HeartHandshake,
  X,
  Search,
  KeyRound,
} from 'lucide-react';
import { openCommandPalette } from './CommandPalette';
import { promptForStaffKey } from '@/lib/utils/staff-key';

const NAV_ITEMS = [
  { href: '/orchestrator', label: 'Network Overview', icon: LayoutDashboard },
  { href: '/approvals',   label: 'Pending Approvals', icon: Inbox, showBadge: true },
  { href: '/agents',      label: 'Agent Decisions',   icon: Bot },
  { href: '/logistics',   label: 'Fleet & Logistics', icon: Truck },
  { href: '/storage',     label: 'Storage',           icon: Warehouse },
  { href: '/dispatch',    label: 'Partner Dispatch',  icon: HeartHandshake },
  { href: '/donors',      label: 'Donors',            icon: Users },
];

export function Sidebar({
  open = false,
  onNavigate,
}: {
  open?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch('/api/approvals');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setPendingCount((data.listings ?? []).length);
        }
      } catch { /* badge stays at last known count */ }
    }
    poll();
    const interval = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <aside
      id="app-sidebar"
      className={`app-sidebar flex flex-col ${open ? 'open' : ''}`}
      aria-label="Main navigation"
      aria-hidden={!open && undefined}
    >
      {/* ── Logo ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5" style={{ height: 68 }}>
        {/* Solid black mark — no colour, no glow, matches the editorial-light theme */}
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ width: 32, height: 32, background: '#000000' }}
        >
          <Image src="/brand/logo-mark-white.png" alt="" width={19} height={19} priority />
        </div>

        <div className="flex flex-col leading-none min-w-0">
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              color: 'var(--text-primary)',
            }}
          >
            Bitewise
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.06em',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            Willing Hearts
          </span>
        </div>

        <button
          type="button"
          className="icon-btn mobile-only ml-auto"
          style={{ width: 30, height: 30 }}
          onClick={onNavigate}
          aria-label="Close navigation"
        >
          <X size={15} />
        </button>
      </div>

      {/* Hairline separator */}
      <div style={{ height: '0.5px', background: 'var(--border-default)', margin: '0 16px 10px' }} />

      {/* ── Search / Jump ───────────────────────────────────────────────────── */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex items-center gap-2 w-full"
          style={{
            padding: '8px 12px',
            borderRadius: 9,
            background: 'var(--bg-hover)',
            border: '0.5px solid var(--border-default)',
            cursor: 'pointer',
            color: 'var(--text-tertiary)',
            fontSize: 13,
            letterSpacing: '-0.01em',
          }}
        >
          <Search size={13} />
          Jump to…
          <span className="kbd ml-auto">⌘K</span>
        </button>
      </div>

      {/* ── Navigation ──────────────────────────────────────────────────────── */}
      <nav className="flex flex-col mt-1 flex-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`nav-link ${active ? 'active' : ''}`}
              style={{ justifyContent: 'space-between' }}
            >
              <span className="flex items-center gap-2.5">
                <Icon
                  size={15}
                  strokeWidth={active ? 2.2 : 1.8}
                  style={{ opacity: active ? 1 : 0.7 }}
                />
                {item.label}
              </span>

              {item.showBadge && pendingCount > 0 && (
                <span
                  aria-label={`${pendingCount} pending`}
                  style={{
                    background: '#ff9500',
                    color: '#000',
                    borderRadius: 8,
                    minWidth: 18,
                    height: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    padding: '0 5px',
                  }}
                >
                  <span aria-hidden="true">{pendingCount}</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 10px 20px' }}>
        <div style={{ height: '0.5px', background: 'var(--border-default)', margin: '0 4px 12px' }} />
        <Link
          href="/recipient"
          className="nav-link"
          style={{ margin: 0 }}
        >
          <ArrowLeftRight size={14} strokeWidth={1.8} style={{ opacity: 0.6 }} />
          Public View
        </Link>
        <button
          type="button"
          onClick={promptForStaffKey}
          className="nav-link"
          style={{ margin: 0, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <KeyRound size={14} strokeWidth={1.8} style={{ opacity: 0.6 }} />
          Staff Key
        </button>
        <p
          style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
            padding: '8px 14px 0',
            lineHeight: 1.4,
          }}
        >
          Willing Hearts · Singapore
        </p>
      </div>
    </aside>
  );
}
