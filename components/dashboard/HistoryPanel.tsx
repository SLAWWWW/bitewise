'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { History, PackageCheck, HeartHandshake, Recycle } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchJson } from '@/lib/utils/fetch-json';

interface HistoryEntry {
  id: string;
  item_name: string;
  quantity_kg: number;
  food_type: string;
  donor_name: string | null;
  branch_name: string | null;
  completed_via: 'public_pickup' | 'partner_delivery' | 'recycled' | null;
  delivered_at: string;
}

const OUTCOME_META: Record<
  'public_pickup' | 'partner_delivery' | 'recycled',
  { icon: typeof PackageCheck; label: string; color: string }
> = {
  public_pickup: { icon: PackageCheck, label: 'Collected by recipient', color: 'var(--success)' },
  partner_delivery: { icon: HeartHandshake, label: 'Delivered to partner', color: 'var(--accent)' },
  recycled: { icon: Recycle, label: 'Recycled', color: 'var(--text-tertiary)' },
};

/**
 * Every donation's finished story from the last 24 hours — the one place a
 * completed donation appears once it's done. It no longer clutters Agent
 * Decisions, the Command Center feed, Storage, or Dispatch (all of those now
 * show active work only); this panel is where it goes instead. Nothing is
 * deleted to make room here — food_listings rows persist forever — so this
 * naturally "resets every 24h" as entries age out of the time window, no
 * cleanup job required.
 */
export function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetchJson<{ entries: HistoryEntry[] }>('/api/history')
        .then((d) => {
          if (!cancelled) setEntries(d.entries ?? []);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <GlassCard className="p-5 flex flex-col gap-3.5">
      <div className="flex items-center gap-2">
        <History size={14} color="var(--text-tertiary)" />
        <span className="text-overline">History — last 24 hours</span>
      </div>

      {entries === null && (
        <div className="flex flex-col gap-2">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      )}

      {entries?.length === 0 && (
        <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
          Nothing completed in the last 24 hours yet.
        </p>
      )}

      {entries && entries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {entries.map((e) => {
            const meta = e.completed_via ? OUTCOME_META[e.completed_via] : null;
            const Icon = meta?.icon ?? PackageCheck;
            return (
              <Link
                key={e.id}
                href={`/item/${e.id}`}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover-lift"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon size={13} color={meta?.color ?? 'var(--text-tertiary)'} style={{ flexShrink: 0 }} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-caption truncate" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {e.quantity_kg}kg {e.item_name}
                    </span>
                    <span className="text-caption" style={{ fontSize: 11 }}>
                      {e.donor_name ?? 'Unknown donor'}
                      {e.branch_name ? ` → ${e.branch_name}` : ''} · {meta?.label ?? 'Completed'}
                    </span>
                  </div>
                </div>
                <span className="text-caption flex-shrink-0" style={{ fontSize: 11 }}>
                  {formatDistanceToNow(new Date(e.delivered_at), { addSuffix: true })}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
