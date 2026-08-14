'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';

/**
 * The NGO-view chrome: persistent sidebar on desktop, off-canvas drawer with a
 * top bar below 1024px. Every NGO page renders through this so the responsive
 * behaviour is defined once rather than per page.
 */
export function AppShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Close the drawer if the viewport grows past the breakpoint while it's open,
  // otherwise it stays stuck open as a fixed overlay on desktop.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1025px)');
    const onChange = () => mq.matches && setNavOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Prevent the page behind the drawer from scrolling on touch devices.
  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setNavOpen(false);
        menuBtnRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus trap: when the mobile drawer is open, keep Tab/Shift+Tab inside the sidebar.
  useEffect(() => {
    if (!navOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    // Move focus into the sidebar on open.
    const firstFocusable = sidebar.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        sidebar!.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.closest('[aria-hidden="true"]'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [navOpen]);

  return (
    <div className="app-shell">
      <div
        className={`sidebar-scrim ${navOpen ? 'open' : ''}`}
        onClick={() => {
          setNavOpen(false);
          menuBtnRef.current?.focus();
        }}
        aria-hidden="true"
      />
      <div ref={sidebarRef}>
        <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <div className="app-topbar">
          <button
            ref={menuBtnRef}
            type="button"
            className="icon-btn"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
          >
            <Menu size={17} aria-hidden="true" />
          </button>
          <span className="text-title-2 truncate">{title}</span>
        </div>

        <main className="app-main">
          <Header title={title} subtitle={subtitle} action={action} />
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
