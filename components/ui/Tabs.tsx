'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface TabDef {
  id: string;
  label: string;
  /** Optional count/badge shown after the label. */
  badge?: ReactNode;
}

export function tabDomIds(baseId: string, tabId: string) {
  return { tab: `${baseId}-tab-${tabId}`, panel: `${baseId}-panel-${tabId}` };
}

/**
 * URL-driven tabs (`?tab=<id>`), so tabs are linkable and server-rendered. ARIA tabs
 * pattern: roving tabindex, ←/→/Home/End move between tabs and activate them.
 * The server page reads `searchParams.tab` and passes it as `active`, then renders
 * the panel inside <TabPanel baseId tabId>.
 */
export function Tabs({
  tabs,
  active,
  label,
  baseId = 'tabs',
  param = 'tab',
}: {
  tabs: readonly TabDef[];
  /** Active tab id (from the server's searchParams); defaults to the first tab. */
  active?: string;
  /** Accessible name of the tab list. */
  label: string;
  baseId?: string;
  param?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const current = tabs.some((t) => t.id === active) ? active! : tabs[0]?.id;

  const hrefFor = (id: string) => {
    const sp = new URLSearchParams(search?.toString() ?? '');
    if (id === tabs[0]?.id) sp.delete(param);
    else sp.set(param, id);
    const qs = sp.toString();
    return `${pathname}${qs ? `?${qs}` : ''}`;
  };

  function onKeyDown(e: KeyboardEvent<HTMLAnchorElement>, i: number) {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    router.replace(hrefFor(tabs[next].id), { scroll: false });
  }

  return (
    <div className="lb-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => {
        const selected = tab.id === current;
        const ids = tabDomIds(baseId, tab.id);
        return (
          <Link
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={ids.tab}
            href={hrefFor(tab.id)}
            role="tab"
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            scroll={false}
            replace
            className={`lb-tab ${selected ? 'is-active' : ''}`}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.label}
            {tab.badge !== undefined && <span className="lb-tab-badge">{tab.badge}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/** Panel for the active tab. Server-safe. */
export function TabPanel({ baseId = 'tabs', tabId, children }: { baseId?: string; tabId: string; children: ReactNode }) {
  const ids = tabDomIds(baseId, tabId);
  return (
    <div id={ids.panel} role="tabpanel" aria-labelledby={ids.tab} tabIndex={0} className="lb-tabpanel">
      {children}
    </div>
  );
}
