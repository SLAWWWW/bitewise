import {
  ClipboardCheck,
  LayoutDashboard,
  MessageSquare,
  Network,
  Package,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRoundCheck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { NavIcon } from '@/src/ui/nav';

/** lucide components for the icon names used in src/ui/nav.ts. */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  LayoutDashboard,
  Package,
  Sparkles,
  ShieldCheck,
  Users,
  Warehouse,
  Truck,
  Route,
  UserRoundCheck,
  MessageSquare,
  Network,
  ClipboardCheck,
  Settings,
  ScrollText,
};
