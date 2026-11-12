import type { LucideIcon } from 'lucide-react';
import {
  Archive, Bot, ClipboardCheck, Database, FileCheck2, FileInput, FolderLock,
  GitBranch, Globe2, Hand, History, Inbox, Layers3, ListChecks, LockKeyhole,
  MessageSquare, Package, RefreshCw, Scale, Server, ShieldCheck, Timer,
  Truck, Users, Warehouse,
} from 'lucide-react';

export const GUIDE_ICONS = {
  Archive, Bot, ClipboardCheck, Database, FileCheck2, FileInput, FolderLock,
  GitBranch, Globe2, Hand, History, Inbox, Layers3, ListChecks, LockKeyhole,
  MessageSquare, Package, RefreshCw, Scale, Server, ShieldCheck, Timer,
  Truck, Users, Warehouse,
} satisfies Record<string, LucideIcon>;

export interface GuideNode {
  id: string;
  title: string;
  summary: string;
  icon: keyof typeof GUIDE_ICONS;
  kind: 'person' | 'system' | 'gate' | 'store';
  owner: string;
  input: string;
  action: string;
  output: string;
  exception: string;
  example?: string;
  href?: string;
  source: string[];
  /** Only architecture uses explicit positions; sequential maps use a snake. */
  column?: number;
  row?: number;
}

export interface GuideEdge {
  from: string;
  to: string;
  label?: string;
  both?: boolean;
}

export interface GuideMap {
  id: string;
  label: string;
  title: string;
  description: string;
  takeaway: string;
  sequence: boolean;
  nodes: GuideNode[];
  edges: GuideEdge[];
}
