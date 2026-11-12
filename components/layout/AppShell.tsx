'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Clock, Menu, UserRound } from 'lucide-react';
import { useLocale, useT } from '@/src/i18n/client';
import { LOCALE_COOKIE, type Locale } from '@/src/i18n/types';
import { formatWib } from '@/src/lib/tz';
import type { NavItem } from '@/src/ui/nav';
import { isActive } from '@/src/ui/nav';
import { Walkthrough } from '@/components/walkthrough/Walkthrough';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { displayedClockInstant, type ClockTick } from './clock-display';

export interface ShellUser {
  displayName: string;
  /** Already translated role label. */
  roleLabel: string;
  tenantName: string;
}

export interface ShellClock {
  /** ISO instant of tenant_now() at render time. */
  now: string;
  mode: 'FROZEN' | 'TICKING' | 'REAL';
  tz: string;
}

/**
 * Operations chrome: sidebar (drawer below 1024px), prominent simulation banner,
 * status bar with the tenant clock (WIB), current user + "Ganti pengguna", and the
 * id/en toggle. Rendered once by app/(ops)/layout.tsx; pages render <Header/>.
 */
export function AppShell({
  nav,
  user,
  mode,
  clock,
  children,
}: {
  nav: readonly NavItem[];
  user: ShellUser;
  mode: 'DEMO' | 'TEST' | 'LIVE';
  clock: ShellClock | null;
  children: ReactNode;
}) {
  const t = useT('common');
  const pathname = usePathname();
  const prototypePage = nav.some(item => item.prototypeOnly && isActive(item, pathname));
  const [navOpen, setNavOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => mq.matches && setNavOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && navOpen) {
        setNavOpen(false);
        menuBtnRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // Focus trap inside the mobile drawer.
  useEffect(() => {
    if (!navOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const selector = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    sidebar.querySelector<HTMLElement>(selector)?.focus();
    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(sidebar!.querySelectorAll<HTMLElement>(selector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [navOpen]);

  return (
    <div className="app-shell">
      <a href="#main" className="lb-skip-link">
        {t('nav.label')}
      </a>
      <div
        className={`sidebar-scrim ${navOpen ? 'open' : ''}`}
        onClick={() => {
          setNavOpen(false);
          menuBtnRef.current?.focus();
        }}
        aria-hidden="true"
      />
      <div ref={sidebarRef}>
        <Sidebar items={nav} tenantName={user.tenantName} open={navOpen} onNavigate={() => setNavOpen(false)} />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        {mode !== 'LIVE' && <ModeBanner mode={mode} />}

        <div className="app-topbar">
          <button
            ref={menuBtnRef}
            type="button"
            className="icon-btn"
            onClick={() => setNavOpen(true)}
            aria-label={t('nav.open')}
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
          >
            <Menu size={17} aria-hidden="true" />
          </button>
          <span className="flex items-center gap-2 min-w-0">
            <span
              className="flex items-center justify-center rounded-lg flex-shrink-0"
              style={{ width: 24, height: 24, background: '#000' }}
            >
              <Image src="/brand/logo-mark-white.png" alt="" width={14} height={14} />
            </span>
            <span className="text-title-2 truncate">{t('app.brand')}</span>
          </span>
        </div>

        <StatusBar user={user} clock={clock} />

        <main id="main" className="app-main" tabIndex={-1}>
          {!prototypePage && <Walkthrough nav={nav} />}
          {children}
        </main>
      </div>

      <CommandPalette items={nav} />
    </div>
  );
}

function ModeBanner({ mode }: { mode: 'DEMO' | 'TEST' }) {
  const t = useT('common');
  return (
    <div className="lb-mode-banner" role="note" aria-label={t(`mode.${mode}`)}>
      <span className="lb-mode-tag">{t(`mode.${mode}`)}</span>
      <span>{t(`mode.banner.${mode}`)}</span>
    </div>
  );
}

function StatusBar({ user, clock }: { user: ShellUser; clock: ShellClock | null }) {
  const t = useT('common');
  return (
    <div className="lb-statusbar">
      <ClockPill clock={clock} />
      <div className="lb-statusbar-user">
        <UserRound size={14} aria-hidden="true" />
        <span className="sr-only">{t('user.signedInAs')}</span>
        <span className="lb-user-name">{user.displayName}</span>
        <span className="lb-user-role">{user.roleLabel}</span>
        <Link href="/masuk" className="lb-link">
          {t('user.switch')}
        </Link>
      </div>
      <LocaleToggle />
    </div>
  );
}

/** Tenant clock. TICKING/REAL advance locally from the server value; FROZEN stays put. */
function ClockPill({ clock }: { clock: ShellClock | null }) {
  const t = useT('common');
  const locale = useLocale();
  // Only the locally advanced tick is state; the shown instant is derived from the current
  // server prop, so a refreshed clock (advance / reset / mode change) shows immediately.
  const [tick, setTick] = useState<ClockTick | null>(null);
  const now = displayedClockInstant(clock, tick);
  const serverNow = clock?.now;
  const serverMode = clock?.mode;

  useEffect(() => {
    if (!serverNow || !serverMode || serverMode === 'FROZEN') return;
    // UI display only (not domain logic): advance from the server value by elapsed wall time.
    const base = new Date(serverNow).getTime();
    const started = performance.now();
    const id = window.setInterval(() => {
      setTick({ base: serverNow, mode: serverMode, at: new Date(base + (performance.now() - started)).toISOString() });
    }, 15_000);
    return () => window.clearInterval(id);
  }, [serverNow, serverMode]);

  if (!clock || !now) {
    return (
      <span className="lb-pill lb-pill-muted">
        <Clock size={13} aria-hidden="true" />
        {t('clock.unavailable')}
      </span>
    );
  }
  return (
    <span className="lb-pill" data-tour="clock" title={t('clock.label')}>
      <Clock size={13} aria-hidden="true" />
      <span className="sr-only">{t('clock.label')}: </span>
      <time dateTime={now}>{formatWib(now, { locale, tz: clock.tz })}</time>
      <span className="lb-pill-sub">· {t(`clock.${clock.mode}`)}</span>
    </span>
  );
}

/** Persist the UI language (read server-side by app/layout.tsx and src/i18n/server.ts). */
function writeLocaleCookie(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

function LocaleToggle() {
  const t = useT('common');
  const locale = useLocale();
  const router = useRouter();
  function choose(next: Locale) {
    if (next === locale) return;
    writeLocaleCookie(next);
    router.refresh();
  }
  return (
    <div className="lb-locale-toggle" role="group" aria-label={t('locale.label')}>
      {(['id', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          lang={l}
          title={t(`locale.${l}`)}
          onClick={() => choose(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
