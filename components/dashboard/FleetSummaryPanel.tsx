'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Truck,
  ArrowRight,
  ArrowRightLeft,
  CircleDot,
  AlertTriangle,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton, EmptyState } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { fetchJson, FetchError } from '@/lib/utils/fetch-json';
import type { FleetResponse } from '@/lib/types';

const STATUS_META: Record<string, { label: string; color: string }> = {
  assigned: { label: 'Assigned', color: 'var(--monitor)' },
  en_route: { label: 'En route', color: 'var(--accent)' },
  picked_up: { label: 'Picked up', color: 'var(--info)' },
};

const NEXT_ACTION: Record<string, string> = {
  assigned: 'Mark en route',
  en_route: 'Mark picked up',
  picked_up: 'Complete',
};

/** Condensed live-ops view of the fleet for the Network Overview dashboard —
 *  active runs with inline control, and per-branch coverage at a glance.
 *  Full vehicle roster and history live on /logistics. */
export function FleetSummaryPanel() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const toast = useToast();

  const fetchFleet = useCallback(async () => {
    try {
      setData(await fetchJson<FleetResponse>('/api/fleet'));
    } catch {
      // Keep previous fleet data on transient poll error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFleet();
    const interval = setInterval(fetchFleet, 8000);
    return () => clearInterval(interval);
  }, [fetchFleet]);

  async function advance(runId: string, vehicleLabel: string) {
    setBusyRunId(runId);
    try {
      const res = await fetchJson<{ success: boolean; status?: string; message?: string }>(
        `/api/fleet/${runId}/advance`,
        { method: 'POST', body: { action: 'advance' } }
      );
      if (res.success) {
        toast('success', `${vehicleLabel} → ${String(res.status).replace('_', ' ')}`);
      } else {
        toast('warning', res.message ?? 'Could not update that run.');
      }
      fetchFleet();
    } catch (err) {
      toast('warning', err instanceof FetchError ? err.message : 'Network error — try again.');
    } finally {
      setBusyRunId(null);
    }
  }

  const unavailable = data?.error === 'fleet_unavailable';
  const fleet = data?.fleet ?? [];
  const active = fleet.filter((v) => v.current_run).slice(0, 4);
  const idleCount = fleet.filter((v) => v.status === 'idle').length;
  const strained = (data?.coverage ?? []).filter((c) => c.idle === 0);

  return (
    <GlassCard className="p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck size={15} color="var(--accent)" />
          <span className="text-title-2">Fleet &amp; Logistics</span>
        </div>
        <Link href="/logistics" className="text-caption flex items-center gap-1" style={{ color: 'var(--accent)' }}>
          Full fleet <ArrowRight size={11} />
        </Link>
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      )}

      {!loading && unavailable && (
        <EmptyState
          icon={<Truck size={17} color="var(--warning)" />}
          title="Fleet tracking isn't set up"
          description="Run supabase/migrations/006_fleet.sql to enable it."
        />
      )}

      {!loading && !unavailable && data && (
        <>
          <div className="flex items-center gap-3 flex-wrap text-caption">
            <span>
              <strong className="tnum" style={idleCount === 0 ? { color: 'var(--critical)' } : undefined}>
                {idleCount}
              </strong>{' '}
              idle / <span className="tnum">{fleet.length}</span> total
            </span>
            {strained.length > 0 && (
              <span className="flex items-center gap-1" style={{ color: 'var(--warning)' }}>
                <AlertTriangle size={11} />
                {strained.length} branch{strained.length === 1 ? '' : 'es'} with no free vehicle
              </span>
            )}
          </div>

          {active.length === 0 ? (
            <p className="text-caption">No active runs right now — every vehicle is idle.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {active.map((v) => {
                const run = v.current_run!;
                const meta = STATUS_META[run.status];
                return (
                  <GlassCard
                    key={v.id}
                    variant="nested"
                    className="flex items-center justify-between gap-3 p-2.5 flex-wrap"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CircleDot size={11} color={meta.color} style={{ flexShrink: 0 }} />
                      <div className="flex flex-col min-w-0">
                        <span className="text-caption mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {v.label}
                          {run.is_cross_branch && (
                            <span style={{ color: 'var(--warning)' }}>
                              {' '}
                              <ArrowRightLeft size={9} style={{ display: 'inline' }} /> on loan
                            </span>
                          )}
                        </span>
                        <span className="text-caption truncate" style={{ fontSize: 11 }}>
                          {run.listing ? `${run.listing.quantity_kg}kg ${run.listing.item_name}` : 'Collection run'} →{' '}
                          {run.serving_branch_name.replace('Willing Hearts — ', '')}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary flex-shrink-0"
                      style={{ padding: '6px 11px', fontSize: 12 }}
                      disabled={busyRunId === run.id}
                      onClick={() => advance(run.id, v.label)}
                    >
                      {busyRunId === run.id ? '…' : NEXT_ACTION[run.status]}
                    </button>
                  </GlassCard>
                );
              })}
              {fleet.filter((v) => v.current_run).length > active.length && (
                <Link href="/logistics" className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
                  +{fleet.filter((v) => v.current_run).length - active.length} more active — view all →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}
