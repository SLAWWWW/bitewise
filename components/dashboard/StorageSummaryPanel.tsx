'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Warehouse, ArrowRight, AlertTriangle, Globe, Lock, HeartHandshake } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchJson } from '@/lib/utils/fetch-json';
import { URGENCY_TOOLTIP } from '@/lib/storage-zones';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { StorageResponse, StorageItemView } from '@/lib/types';

const URGENCY_BADGE: Record<string, string> = {
  expired: 'badge-critical',
  critical: 'badge-critical',
  urgent: 'badge-urgent',
};

/** Condensed network-wide storage health for the Network Overview dashboard —
 *  what's about to spoil, and whether any rack or zone needs attention. Full
 *  zone-by-zone, branch-by-branch breakdown lives on /storage. */
export function StorageSummaryPanel() {
  const [data, setData] = useState<StorageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStorage = useCallback(async () => {
    try {
      setData(await fetchJson<StorageResponse>('/api/storage'));
    } catch {
      // Keep previous data on transient poll error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStorage();
    const interval = setInterval(fetchStorage, 15000);
    return () => clearInterval(interval);
  }, [fetchStorage]);

  const s = data?.summary;

  // Flatten every branch's zones down to the most time-critical items network-wide.
  const urgentItems: (StorageItemView & { branch_name: string; branch_color: string })[] =
    (data?.branches ?? [])
      .flatMap((b) =>
        b.zones.flatMap((z) =>
          z.items.map((i) => ({ ...i, branch_name: b.branch_name, branch_color: b.color }))
        )
      )
      .filter((i) => i.urgency === 'critical' || i.urgency === 'urgent')
      .sort((a, b) => a.shelf_life_hours - b.shelf_life_hours)
      .slice(0, 4);

  return (
    <GlassCard className="p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Warehouse size={15} color="var(--accent)" />
          <span className="text-title-2">Storage &amp; Inventory</span>
        </div>
        <Link href="/storage" className="text-caption flex items-center gap-1" style={{ color: 'var(--accent)' }}>
          Full breakdown <ArrowRight size={11} />
        </Link>
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          <Skeleton height={24} />
          <Skeleton height={40} />
        </div>
      )}

      {!loading && data && (
        <>
          <div className="flex items-center gap-3 flex-wrap text-caption">
            <span className="flex items-center gap-1">
              <Globe size={11} color="var(--success)" />
              <strong className="tnum" style={{ color: 'var(--text-primary)' }}>
                {s?.publicly_listed ?? 0}
              </strong>{' '}
              listed
            </span>
            <span className="flex items-center gap-1">
              <Lock size={11} color="var(--monitor)" />
              <strong className="tnum" style={{ color: 'var(--text-primary)' }}>
                {s?.reserved ?? 0}
              </strong>{' '}
              reserved
            </span>
            <span className="flex items-center gap-1">
              <HeartHandshake size={11} color="var(--info)" />
              <strong className="tnum" style={{ color: 'var(--text-primary)' }}>
                {s?.escalated ?? 0}
              </strong>{' '}
              to partners
            </span>
            {(s?.racks_full ?? 0) > 0 && (
              <span className="flex items-center gap-1" style={{ color: 'var(--warning)' }}>
                <AlertTriangle size={11} />
                {s?.racks_full} rack{s?.racks_full === 1 ? '' : 's'} at capacity
              </span>
            )}
          </div>

          {urgentItems.length === 0 ? (
            <p className="text-caption">Nothing urgent right now — everything has healthy shelf life.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {urgentItems.map((item) => {
                const row = (
                  <GlassCard
                    variant="nested"
                    hover={!!item.listing_id}
                    className={`flex items-center justify-between gap-3 p-2.5 flex-wrap ${item.listing_id ? 'cursor-pointer' : ''}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="flex-shrink-0 rounded-sm"
                        style={{ width: 7, height: 7, background: item.branch_color }}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-caption truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.item_name}
                        </span>
                        <span className="text-caption" style={{ fontSize: 11 }}>
                          {item.branch_name.replace('Willing Hearts — ', '')}
                        </span>
                      </div>
                    </div>
                    <span className="flex items-center flex-shrink-0">
                      <span className={`badge ${URGENCY_BADGE[item.urgency] ?? 'badge-neutral'} tnum`}>
                        {item.shelf_life_label}
                      </span>
                      <InfoTooltip text={URGENCY_TOOLTIP} size={9} />
                    </span>
                  </GlassCard>
                );
                return item.listing_id ? (
                  <Link key={item.id} href={`/item/${item.listing_id}`} className="block">
                    {row}
                  </Link>
                ) : (
                  <div key={item.id}>{row}</div>
                );
              })}
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}
