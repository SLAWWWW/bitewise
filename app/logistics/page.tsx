'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Truck,
  Snowflake,
  Bike,
  Package,
  ArrowRightLeft,
  CircleDot,
  CheckCircle2,
  AlertTriangle,
  History,
  MapPin,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { SkeletonList, EmptyState } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { fetchJson, FetchError } from '@/lib/utils/fetch-json';
import type { FleetResponse, FleetVehicleView } from '@/lib/types';

const TYPE_ICON: Record<string, typeof Truck> = {
  refrigerated: Snowflake,
  truck: Truck,
  van: Package,
  bike: Bike,
};

const STATUS_META: Record<string, { label: string; color: string; badge: string }> = {
  idle: { label: 'Idle', color: 'var(--text-tertiary)', badge: 'badge-neutral' },
  assigned: { label: 'Assigned', color: 'var(--monitor)', badge: 'badge-monitor' },
  en_route: { label: 'En route', color: 'var(--accent)', badge: 'badge-accent' },
  picked_up: { label: 'Picked up', color: 'var(--info)', badge: 'badge-info' },
  offline: { label: 'Offline', color: 'var(--text-tertiary)', badge: 'badge-neutral' },
};

const NEXT_ACTION: Record<string, string> = {
  assigned: 'Mark en route',
  en_route: 'Mark picked up',
  picked_up: 'Complete run',
};

function VehicleRow({
  vehicle,
  onChanged,
}: {
  vehicle: FleetVehicleView;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'advance' | 'cancel' | null>(null);
  const toast = useToast();
  const Icon = TYPE_ICON[vehicle.type] ?? Truck;
  const meta = STATUS_META[vehicle.status];
  const run = vehicle.current_run;

  async function act(action: 'advance' | 'cancel') {
    if (!run) return;
    setBusy(action);
    try {
      const data = await fetchJson<{ success: boolean; status?: string; message?: string }>(
        `/api/fleet/${run.id}/advance`,
        { method: 'POST', body: { action } }
      );
      if (data.success) {
        toast(
          'success',
          action === 'cancel'
            ? `${vehicle.label} run cancelled — vehicle back to idle`
            : `${vehicle.label} → ${String(data.status).replace('_', ' ')}`
        );
      } else {
        toast('warning', data.message ?? 'Could not update that run.');
      }
      onChanged();
    } catch (err) {
      if (err instanceof FetchError) {
        const body = err.body as Record<string, unknown> | null;
        toast('warning', (body?.message as string) ?? err.message);
      } else {
        toast('error', 'Network error — try again.');
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 p-3.5 rounded-lg"
      style={{
        background: run ? 'var(--bg-hover)' : 'transparent',
        border: '0.5px solid var(--border-default)',
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex items-center justify-center rounded-lg flex-shrink-0"
            style={{
              width: 32,
              height: 32,
              background: `color-mix(in srgb, ${meta.color} 14%, var(--bg-elevated))`,
              border: `0.5px solid color-mix(in srgb, ${meta.color} 40%, transparent)`,
            }}
          >
            <Icon size={15} color={meta.color} />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-body mono" style={{ fontWeight: 600 }}>
                {vehicle.label}
              </span>
              <span className={`badge ${meta.badge}`}>
                <CircleDot size={9} />
                {meta.label}
              </span>
              {run?.is_cross_branch && (
                <span className="badge badge-urgent">
                  <ArrowRightLeft size={9} />
                  On loan
                </span>
              )}
            </div>
            <span className="text-caption" style={{ fontSize: 11 }}>
              {vehicle.driver_name} · <span className="capitalize">{vehicle.type}</span> ·{' '}
              <span className="tnum">{vehicle.capacity_kg}kg</span>
            </span>
          </div>
        </div>

        {run && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '7px 13px', fontSize: 13 }}
              disabled={busy !== null}
              onClick={() => act('advance')}
            >
              {busy === 'advance' ? 'Updating…' : NEXT_ACTION[run.status]}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '7px 11px', fontSize: 13 }}
              disabled={busy !== null}
              onClick={() => act('cancel')}
            >
              {busy === 'cancel' ? '…' : 'Cancel'}
            </button>
          </div>
        )}
      </div>

      {run && (
        <div
          className="flex flex-col gap-1.5 pl-1"
          style={{ borderLeft: `2px solid ${meta.color}`, paddingLeft: 10 }}
        >
          <span className="text-body">
            {run.listing
              ? `${run.listing.quantity_kg}kg ${run.listing.item_name}`
              : 'Collection run'}
          </span>
          {run.listing?.donor && (
            <span className="text-caption flex items-center gap-1.5" style={{ fontSize: 11 }}>
              <MapPin size={10} style={{ flexShrink: 0 }} />
              {run.listing.donor.name}
              {run.listing.donor.address ? ` · ${run.listing.donor.address}` : ''}
            </span>
          )}
          <span className="text-caption" style={{ fontSize: 11 }}>
            Serving <strong style={{ color: 'var(--text-primary)' }}>
              {run.serving_branch_name.replace('Willing Hearts — ', '')}
            </strong>
            {run.is_cross_branch && ` (borrowed from ${vehicle.home_branch_name.replace('Willing Hearts — ', '')})`}
            {run.assigned_at && ` · assigned ${formatDistanceToNow(new Date(run.assigned_at), { addSuffix: true })}`}
          </span>
        </div>
      )}
    </div>
  );
}

export default function LogisticsPage() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);

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

  const unavailable = data?.error === 'fleet_unavailable';
  const fleet = data?.fleet ?? [];
  const idle = fleet.filter((v) => v.status === 'idle').length;
  const active = fleet.filter((v) => v.current_run).length;
  const onLoan = fleet.filter((v) => v.current_run?.is_cross_branch).length;

  return (
    <AppShell
      title="Fleet & Logistics"
      subtitle="Every vehicle, what it's carrying, and which branch it's covering."
    >
      {loading && <SkeletonList count={3} lines={3} />}

      {!loading && unavailable && (
        <EmptyState
          icon={<Truck size={19} color="var(--warning)" />}
          title="Fleet tracking isn't set up yet"
          description={data?.message ?? 'Run supabase/migrations/006_fleet.sql in the Supabase SQL editor, then reload this page.'}
        />
      )}

      {!loading && !unavailable && data && (
        <>
          <div className="grid-stats mb-5">
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Fleet size</span>
              <span className="text-title-1 tnum">{fleet.length}</span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                across {data.coverage.length} branches
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Available now</span>
              <span className="text-title-1 tnum" style={idle === 0 ? { color: 'var(--critical)' } : undefined}>
                {idle}
              </span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                {idle === 0 ? 'nothing free — network saturated' : 'idle and ready'}
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">On a run</span>
              <span className="text-title-1 tnum">{active}</span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                {onLoan > 0 ? `${onLoan} borrowed cross-branch` : 'all on home turf'}
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Completed runs</span>
              <span className="text-title-1 tnum">
                {data.history.filter((h) => h.status === 'completed').length}
              </span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                in recent history
              </span>
            </GlassCard>
          </div>

          {/* Coverage warnings — the thing staff need to act on. */}
          {data.coverage.some((c) => c.idle === 0) && (
            <GlassCard
              className="p-4 mb-5 flex items-start gap-2.5"
              style={{ borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)' }}
            >
              <AlertTriangle size={15} color="var(--warning)" style={{ marginTop: 1, flexShrink: 0 }} />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-body" style={{ fontWeight: 600 }}>
                  {data.coverage.filter((c) => c.idle === 0).length} branch
                  {data.coverage.filter((c) => c.idle === 0).length === 1 ? '' : 'es'} with no free vehicle
                </span>
                <span className="text-caption">
                  {data.coverage
                    .filter((c) => c.idle === 0)
                    .map((c) => c.branch_name.replace('Willing Hearts — ', ''))
                    .join(', ')}
                  {' '}— new approvals for these branches will borrow the nearest available vehicle from
                  another branch automatically.
                </span>
              </div>
            </GlassCard>
          )}

          {/* Per-branch coverage */}
          <div className="grid-stats mb-5">
            {data.coverage.map((c) => (
              <GlassCard key={c.branch_id} className="p-3.5 flex flex-col gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="flex-shrink-0 rounded-sm"
                    style={{ width: 8, height: 8, background: c.color }}
                  />
                  <span className="text-body truncate" style={{ fontWeight: 500 }}>
                    {c.branch_name.replace('Willing Hearts — ', '')}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-title-2 tnum" style={c.idle === 0 ? { color: 'var(--critical)' } : undefined}>
                    {c.idle}
                  </span>
                  <span className="text-caption tnum">/ {c.total} free</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {!c.has_refrigerated_idle && (
                    <span className="badge badge-urgent" style={{ fontSize: 10 }}>
                      No chilled van free
                    </span>
                  )}
                  {c.borrowed_in > 0 && (
                    <span className="badge badge-info" style={{ fontSize: 10 }}>
                      +{c.borrowed_in} borrowed in
                    </span>
                  )}
                  {c.lent_out > 0 && (
                    <span className="badge badge-monitor" style={{ fontSize: 10 }}>
                      {c.lent_out} lent out
                    </span>
                  )}
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Vehicles grouped by branch */}
          <div className="flex flex-col gap-4">
            {data.coverage.map((c) => {
              const own = fleet.filter((v) => v.branch_id === c.branch_id);
              if (own.length === 0) return null;
              return (
                <GlassCard key={c.branch_id} className="p-4 sm:p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex-shrink-0 rounded-sm"
                      style={{ width: 9, height: 9, background: c.color }}
                    />
                    <span className="text-title-2">
                      {c.branch_name.replace('Willing Hearts — ', '')}
                    </span>
                    <span className="text-caption" style={{ fontSize: 11 }}>
                      {c.area}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {own.map((v) => (
                      <VehicleRow key={v.id} vehicle={v} onChanged={fetchFleet} />
                    ))}
                  </div>
                </GlassCard>
              );
            })}
          </div>

          {/* Run log */}
          {data.history.length > 0 && (
            <GlassCard className="p-4 sm:p-5 mt-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <History size={14} color="var(--text-secondary)" />
                <span className="text-overline">Recent run log</span>
              </div>
              <div className="flex flex-col">
                {data.history.map((h) => {
                  const v = fleet.find((x) => x.id === h.vehicle_id);
                  return (
                    <div
                      key={h.id}
                      className="flex items-center justify-between gap-3 py-2 flex-wrap"
                      style={{ borderBottom: '0.5px solid var(--border-default)' }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {h.status === 'completed' ? (
                          <CheckCircle2 size={12} color="var(--success)" style={{ flexShrink: 0 }} />
                        ) : (
                          <AlertTriangle size={12} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                        )}
                        <span className="text-caption mono">{v?.label ?? '—'}</span>
                        <span className="text-caption truncate">
                          {h.listing ? `${h.listing.quantity_kg}kg ${h.listing.item_name}` : 'run'}
                        </span>
                      </div>
                      <span className="text-caption capitalize" style={{ fontSize: 11 }}>
                        {h.status}
                        {h.completed_at &&
                          ` · ${formatDistanceToNow(new Date(h.completed_at), { addSuffix: true })}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          )}
        </>
      )}
    </AppShell>
  );
}
