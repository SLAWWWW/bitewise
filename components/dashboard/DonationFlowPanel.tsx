'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Waypoints, ChevronRight } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton, EmptyState } from '@/components/ui/Skeleton';
import { fetchJson } from '@/lib/utils/fetch-json';
import { STEP_META, StageStepper } from '@/components/dashboard/DonationJourney';
import type { PipelineEntry } from '@/lib/types';

/** One row in the feed — no dropdown, no accordion. Clicking it goes to that
 *  donation's own dedicated page, where the full reasoning, journey, and
 *  supply chain plan live without being buried in an expanding list item. */
function FlowRow({ entry }: { entry: PipelineEntry }) {
  const meta = STEP_META[entry.stage];
  const Icon = meta.icon;

  return (
    <Link href={`/item/${entry.id}`} className="block">
      <GlassCard variant="nested" hover className="flex flex-col gap-2 p-3.5 cursor-pointer">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={14} color={meta.color} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span className="text-title-2 truncate">
              {entry.quantity_kg}kg {entry.item_name}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-caption" style={{ fontSize: 11 }}>
              {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
            </span>
            <ChevronRight size={14} color="var(--text-tertiary)" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-caption truncate">
            {entry.donor?.name ?? 'Unknown donor'}
            {entry.branch_name && ` → ${entry.branch_name.replace('Willing Hearts — ', '')}`}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {entry.stage === 'closed' ? (
              <span className="badge badge-critical">{entry.stage_label}</span>
            ) : (
              <>
                <span className="text-caption" style={{ fontSize: 11, color: meta.color, fontWeight: 600 }}>
                  {entry.stage_label}
                </span>
                <StageStepper stage={entry.stage} />
              </>
            )}
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

/** The Command Center's centerpiece: recent donations as one scannable feed,
 *  each with its real current stage and a click-through to that donation's
 *  own dedicated page — approve it if it's still pending, or watch its live
 *  journey (route, vehicle, supply chain plan) if it's already moving. */
export function DonationFlowPanel() {
  const [entries, setEntries] = useState<PipelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPipeline = useCallback(async () => {
    try {
      const data = await fetchJson<{ entries: PipelineEntry[] }>('/api/pipeline');
      setEntries(data.entries ?? []);
    } catch {
      // Keep previous entries on transient poll error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPipeline();
    const interval = setInterval(fetchPipeline, 7000);
    return () => clearInterval(interval);
  }, [fetchPipeline]);

  return (
    <GlassCard className="p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Waypoints size={15} color="var(--accent)" />
        <span className="text-title-2">Live Donations Flow</span>
        {entries.length > 0 && <span className="badge badge-accent tnum">{entries.length}</span>}
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      )}

      {!loading && entries.length === 0 && (
        <EmptyState
          icon={<Waypoints size={19} color="var(--text-tertiary)" />}
          title="No activity yet"
          description="Submitted donations and their journey to a branch will show up here."
        />
      )}

      <div className="flex flex-col gap-2.5">
        {!loading && entries.map((entry) => <FlowRow key={entry.id} entry={entry} />)}
      </div>
    </GlassCard>
  );
}
