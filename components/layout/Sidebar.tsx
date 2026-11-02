'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useT } from '@/src/i18n/client';
import { isActive, type NavItem } from '@/src/ui/nav';
import { openCommandPalette } from './CommandPalette';
import { NAV_ICONS } from './icons';

export function Sidebar({
  items,
  tenantName,
  open = false,
  onNavigate,
}: {
  items: readonly NavItem[];
  tenantName?: string;
  open?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const t = useT('common');

  return (
    <aside id="app-sidebar" className={`app-sidebar flex flex-col ${open ? 'open' : ''}`} aria-label={t('nav.label')}>
      <div className="flex items-center gap-3 px-5" style={{ height: 68 }}>
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ width: 32, height: 32, background: '#000000' }}
        >
          <Image src="/brand/logo-mark-white.png" alt="" width={19} height={19} priority />
        </div>
        <div className="flex flex-col leading-none min-w-0">
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--text-primary)' }}>
            {t('app.brand')}
          </span>
          <span
            className="truncate"
            style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.06em',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            {tenantName ?? t('app.tenant')}
          </span>
        </div>
        <button
          type="button"
          className="icon-btn mobile-only ml-auto"
          style={{ width: 30, height: 30 }}
          onClick={onNavigate}
          aria-label={t('nav.close')}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div style={{ height: '0.5px', background: 'var(--border-default)', margin: '0 16px 10px' }} />

      <div className="px-3 pb-2">
        <button type="button" onClick={openCommandPalette} className="lb-jump">
          <Search size={13} aria-hidden="true" />
          {t('palette.open')}
          <span className="kbd ml-auto" aria-hidden="true">
            ⌘K
          </span>
        </button>
      </div>

      <nav className="flex flex-col mt-1 flex-1" aria-label={t('nav.label')}>
        {items.map((item) => {
          const active = isActive(item, pathname);
          const Icon = NAV_ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`nav-link ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={15} strokeWidth={active ? 2.2 : 1.8} style={{ opacity: active ? 1 : 0.7 }} aria-hidden="true" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: '12px 10px 20px' }}>
        <div style={{ height: '0.5px', background: 'var(--border-default)', margin: '0 4px 12px' }} />
        <p style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.04em', padding: '0 14px', lineHeight: 1.4 }}>
          {t('app.brand')} · {t('app.tagline')}
        </p>
      </div>
    </aside>
  );
}
