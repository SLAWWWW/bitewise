/**
 * Single navigation config for Sidebar, CommandPalette and app/(ops)/layout.tsx.
 * Labels are i18n keys in the `common` namespace. Icons are lucide icon names,
 * resolved in the client components (keeps this file server-safe).
 *
 * `stage` = build stage in which the page lands; items above ENABLED_STAGE are hidden
 * so the demo never links to a missing page. Each stage's foundation agent bumps it.
 */
import type { Capability } from '@/src/shared/capabilities';

export type NavIcon =
  | 'LayoutDashboard'
  | 'Network'
  | 'Package'
  | 'Sparkles'
  | 'ShieldCheck'
  | 'Users'
  | 'Warehouse'
  | 'Truck'
  | 'MessageSquare'
  | 'ClipboardCheck'
  | 'Settings'
  | 'ScrollText';

export interface NavItem {
  href: string;
  /** key in the `common` namespace, e.g. 'nav.flo' */
  labelKey: string;
  /** key in the `common` namespace for the palette hint */
  hintKey: string;
  icon: NavIcon;
  /** Visible when the actor holds ANY of these (empty/undefined = every signed-in user). */
  anyOf?: readonly Capability[];
  stage: 1 | 2 | 3 | 4 | 5;
  /** Temporary documentation, explicitly opted in by the server layout. */
  prototypeOnly?: boolean;
}

/** Highest build stage whose pages exist. */
export const ENABLED_STAGE: NavItem['stage'] = 5;

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/ringkasan', labelKey: 'nav.ringkasan', hintKey: 'nav.hint.ringkasan', icon: 'LayoutDashboard', stage: 1 },
  { href: '/panduan', labelKey: 'nav.panduan', hintKey: 'nav.hint.panduan', icon: 'Network', stage: 5, prototypeOnly: true },
  {
    href: '/donasi',
    labelKey: 'nav.donasi',
    hintKey: 'nav.hint.donasi',
    icon: 'Package',
    anyOf: ['donation.create', 'donation.validate', 'audit.read'],
    stage: 2,
  },
  {
    href: '/rekomendasi',
    labelKey: 'nav.rekomendasi',
    hintKey: 'nav.hint.rekomendasi',
    icon: 'Sparkles',
    anyOf: ['allocation.run', 'outreach.approve'],
    stage: 2,
  },
  {
    href: '/persetujuan',
    labelKey: 'nav.persetujuan',
    hintKey: 'nav.hint.persetujuan',
    icon: 'ShieldCheck',
    anyOf: ['outreach.approve', 'dispatch.approve', 'inventory.adjust.approve', 'receipt.correct.approve'],
    stage: 2,
  },
  { href: '/flo', labelKey: 'nav.flo', hintKey: 'nav.hint.flo', icon: 'Users', anyOf: ['flo.read'], stage: 1 },
  {
    href: '/persediaan',
    labelKey: 'nav.persediaan',
    hintKey: 'nav.hint.persediaan',
    icon: 'Warehouse',
    anyOf: ['allocation.run', 'inventory.receive', 'inventory.inspect', 'inventory.pick', 'inventory.adjust.approve', 'audit.read'],
    stage: 4,
  },
  {
    href: '/pengiriman',
    labelKey: 'nav.pengiriman',
    hintKey: 'nav.hint.pengiriman',
    icon: 'Truck',
    anyOf: ['delivery.dispatch', 'delivery.receive', 'dispatch.approve', 'audit.read'],
    stage: 2,
  },
  {
    href: '/pesan',
    labelKey: 'nav.pesan',
    hintKey: 'nav.hint.pesan',
    icon: 'MessageSquare',
    anyOf: ['conversation.takeover', 'message.send'],
    stage: 3,
  },
  {
    href: '/pelaporan',
    labelKey: 'nav.pelaporan',
    hintKey: 'nav.hint.pelaporan',
    icon: 'ClipboardCheck',
    anyOf: ['evidence.review', 'evidence.submit', 'evidence.excuse'],
    stage: 3,
  },
  { href: '/pengaturan', labelKey: 'nav.pengaturan', hintKey: 'nav.hint.pengaturan', icon: 'Settings', stage: 1 },
  { href: '/audit', labelKey: 'nav.audit', hintKey: 'nav.hint.audit', icon: 'ScrollText', anyOf: ['audit.read'], stage: 1 },
];

/** Items the actor may see, in display order. */
export function navForCapabilities(
  capabilities: readonly string[],
  opts: { enabledStage?: number; items?: readonly NavItem[]; prototypeGuide?: boolean } = {},
): NavItem[] {
  const stage = opts.enabledStage ?? ENABLED_STAGE;
  return (opts.items ?? NAV_ITEMS).filter(
    (i) => i.stage <= stage && (!i.prototypeOnly || opts.prototypeGuide === true)
      && (!i.anyOf || i.anyOf.length === 0 || i.anyOf.some((c) => capabilities.includes(c))),
  );
}

/** Is `pathname` inside the nav item's section? */
export function isActive(item: Pick<NavItem, 'href'>, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}
