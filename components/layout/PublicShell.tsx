'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';

const TABS = [
  { href: '/recipient', label: 'Browse Food' },
  { href: '/donate', label: 'Donate Food' },
];

export function PublicShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <div
        className="flex items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: '0.5px solid var(--border-default)' }}
      >
        <Link href="/recipient" className="flex items-center gap-2 flex-shrink-0">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{ width: 28, height: 28, background: 'var(--accent)' }}
          >
            <Image src="/brand/logo-mark-white.png" alt="" width={17} height={17} priority />
          </div>
          <span className="text-title-2 hidden sm:inline">Bitewise</span>
        </Link>

        <div className="flex items-center gap-1 glass-card-nested p-1">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="text-caption"
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: active ? 'var(--bg-active)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <Link
          href="/orchestrator"
          className="text-caption flex items-center gap-1.5 flex-shrink-0"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeftRight size={13} />
          <span className="hidden sm:inline">NGO View</span>
        </Link>
      </div>

      <div className="mx-auto px-5 py-10" style={{ maxWidth: 640 }}>
        {children}
      </div>
    </div>
  );
}
