'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Warehouse,
  Snowflake,
  Thermometer,
  ChevronDown,
  AlertTriangle,
  Globe,
  Lock,
  HeartHandshake,
  PackageCheck,
  Box,
  Truck,
  Hourglass,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { SkeletonList, EmptyState } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { fetchJson, FetchError } from '@/lib/utils/fetch-json';
import { URGENCY_TOOLTIP } from '@/lib/storage-zones';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { StorageResponse, StorageZoneView } from '@/lib/types';

const RACK_LABEL: Record<string, string> = {
  space: 'Space available',
  filling: 'Filling up',
  full: 'Rack full',
  over: 'Over capacity',
};

/** Recomputed on every 15s poll rather than ticking live — staff don't need
 *  second-by-second precision, just whether a no-show release is imminent. */
function formatDeadline(deadline: string): { label: string; urgent: boolean } {
  const msLeft = new Date(deadline).getTime() - Date.now();
  if (msLeft <= 0) return { label: 'releasing…', urgent: true };
  const totalMinutes = Math.ceil(msLeft / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const label = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  return { label, urgent: totalMinutes <= 5 };
}

// Color is reserved for what needs attention — a nominal reading or a rack
// with room to spare renders in neutral text, not a "success" green, so the
// warm colors (filling up / full / over capacity) actually stand out.
const RACK_COLOR: Record<string, string> = {
  space: 'var(--text-secondary)',
  filling: 'var(--monitor)',
  full: 'var(--warning)',
  over: 'var(--critical)',
};

const HEALTH_COLOR: Record<string, string> = {
  nominal: 'var(--text-secondary)',
  drifting: 'var(--warning)',
  breach: 'var(--critical)',
};

const URGENCY_BADGE: Record<string, string> = {
  expired: 'badge-critical',
  critical: 'badge-critical',
  urgent: 'badge-urgent',
  monitor: 'badge-monitor',
  stable: 'badge-neutral',
};

/** One item row, including the staff-facing "confirm pickup" action for a
 *  reserved item — the missing other half of the claim lifecycle: claiming
 *  used to leave an item 'reserved' forever with no way to mark it collected. */
function StorageItemRow({
  item,
  onUpdated,
}: {
  item: StorageZoneView['items'][number];
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function confirmPickup() {
    setBusy(true);
    try {
      const res = await fetchJson<{ success: boolean; message?: string }>(
        `/api/claims/${item.id}/pickup`,
        { method: 'POST' }
      );
      if (res.success) {
        toast('success', `${item.item_name} marked picked up.`);
        onUpdated();
      } else {
        toast('warning', res.message ?? 'Could not confirm pickup.');
      }
    } catch (err) {
      toast('warning', err instanceof FetchError ? err.message : 'Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPartnerDelivery() {
    setBusy(true);
    try {
      const res = await fetchJson<{ success: boolean; message?: string }>(
        `/api/inventory/${item.id}/confirm-delivery`,
        { method: 'POST' }
      );
      if (res.success) {
        toast('success', `${item.item_name} marked delivered to partner.`);
        onUpdated();
      } else {
        toast('warning', res.message ?? 'Could not confirm delivery.');
      }
    } catch (err) {
      toast('warning', err instanceof FetchError ? err.message : 'Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-3.5 py-2.5 flex-wrap"
      style={{ borderBottom: '0.5px solid var(--border-default)' }}
    >
      <div className="flex flex-col min-w-0" style={{ flex: '1 1 190px' }}>
        {item.listing_id ? (
          <Link
            href={`/item/${item.listing_id}`}
            className="text-body truncate hover:underline"
            style={{ color: 'var(--text-primary)', width: 'fit-content' }}
          >
            {item.item_name}
          </Link>
        ) : (
          <span className="text-body truncate">{item.item_name}</span>
        )}
        <span className="text-caption capitalize" style={{ fontSize: 11 }}>
          {item.food_type} · {item.quantity}
          {item.unit === 'kg' ? 'kg' : ` ${item.unit}`}
          {item.donated_by && <span style={{ textTransform: 'none' }}> · from {item.donated_by}</span>}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Counted here, but not physically here yet. */}
        {!item.delivery.collectable && (
          <span className="badge badge-monitor">
            <Truck size={9} />
            {item.delivery.stage === 'in_transit' ? 'In transit' : 'Not collected'}
          </span>
        )}
        {/* The four states staff ask about, stated not implied. */}
        {item.escalated ? (
          <>
            <span className="badge badge-info">
              <HeartHandshake size={9} />
              Partner dispatch
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: 11 }}
              disabled={busy}
              onClick={confirmPartnerDelivery}
            >
              {busy ? '…' : 'Confirm delivered'}
            </button>
          </>
        ) : item.distributed ? (
          <span className="badge badge-neutral">
            <PackageCheck size={9} />
            Picked up
          </span>
        ) : item.reserved ? (
          <>
            <span className="badge badge-monitor">
              <Lock size={9} />
              Reserved
            </span>
            {item.pickup_deadline_at && (
              <span className={`badge ${formatDeadline(item.pickup_deadline_at).urgent ? 'badge-critical' : 'badge-neutral'} tnum`}>
                <Hourglass size={9} />
                {formatDeadline(item.pickup_deadline_at).label}
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: 11 }}
              disabled={busy}
              onClick={confirmPickup}
            >
              {busy ? '…' : 'Mark picked up'}
            </button>
          </>
        ) : item.publicly_listed ? (
          <span className="badge badge-neutral">
            <Globe size={9} />
            Listed publicly
          </span>
        ) : (
          <span className="badge badge-neutral capitalize">{item.status}</span>
        )}
        <span className="flex items-center">
          <span className={`badge ${URGENCY_BADGE[item.urgency]} tnum`}>{item.shelf_life_label}</span>
          <InfoTooltip text={URGENCY_TOOLTIP} size={9} />
        </span>
      </div>
    </div>
  );
}

function ZonePanel({ zone, onUpdated }: { zone: StorageZoneView; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, zone.occupancy_pct);

  return (
    <div
      className="rounded-lg"
      style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-default)' }}
    >
      <button
        type="button"
        className="w-full flex flex-col gap-2.5 p-3.5 text-left cursor-pointer"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={zone.item_count === 0}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {zone.key === 'ambient' ? (
              <Box size={14} color="var(--text-secondary)" />
            ) : (
              <Snowflake size={14} color="var(--cold, var(--info))" />
            )}
            <span className="text-body" style={{ fontWeight: 600 }}>
              {zone.label}
            </span>
            <span className="text-caption tnum" style={{ fontSize: 11 }}>
              {zone.item_count} {zone.item_count === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="badge"
              style={{
                background: `color-mix(in srgb, ${HEALTH_COLOR[zone.health]} 14%, transparent)`,
                color: HEALTH_COLOR[zone.health],
              }}
            >
              <Thermometer size={9} />
              <span className="tnum">{zone.temperature_c.toFixed(1)}°C</span>
            </span>
            {zone.item_count > 0 && (
              <ChevronDown
                size={14}
                color="var(--text-secondary)"
                style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease' }}
              />
            )}
          </div>
        </div>

        {/* Rack occupancy */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-caption" style={{ fontSize: 11 }}>
            <span style={{ color: RACK_COLOR[zone.rack_state] }}>{RACK_LABEL[zone.rack_state]}</span>
            <span
              className="tnum"
              title="Used kg ÷ this zone's allocated capacity. Picked-up and expired stock don't count here — they've left active inventory, even before their record is fully cleared out."
            >
              {zone.capacity_kg > 0
                ? `${zone.used_kg}/${zone.capacity_kg}kg · ${zone.occupancy_pct}%`
                : `${zone.used_kg}kg · no allocation`}
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${pct}%`, background: RACK_COLOR[zone.rack_state] }}
            />
          </div>
        </div>

        {zone.unsupported_zone && (
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={11} color="var(--critical)" style={{ marginTop: 2, flexShrink: 0 }} />
            <span className="text-caption" style={{ color: 'var(--critical)', fontSize: 11 }}>
              This branch has no {zone.label.toLowerCase()} storage on record, but {zone.item_count} item
              {zone.item_count === 1 ? '' : 's'} {zone.item_count === 1 ? 'is' : 'are'} stored here — verify
              before the next delivery.
            </span>
          </div>
        )}

        <span className="text-caption" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          Setpoint {zone.setpoint_c}°C ±{zone.tolerance_c}°C · {zone.description}
        </span>
      </button>

      {open && zone.items.length > 0 && (
        <div className="flex flex-col rise-in" style={{ borderTop: '0.5px solid var(--border-default)' }}>
          {zone.items.map((item) => (
            <StorageItemRow key={item.id} item={item} onUpdated={onUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StoragePage() {
  const [data, setData] = useState<StorageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStorage = useCallback(async () => {
    try {
      setData(await fetchJson<StorageResponse>('/api/storage'));
    } catch {
      // Keep previous data on network hiccup — the UI shows stale data rather
      // than blanking out on a transient error during the 15-second poll.
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

  return (
    <AppShell
      title="Storage Management"
      subtitle="Every branch by zone: rack occupancy, holding temperature, and what each item is waiting on."
    >
      {loading && <SkeletonList count={3} lines={4} />}

      {!loading && data && (
        <>
          <div className="grid-stats mb-5">
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Items held</span>
              <span className="text-title-1 tnum">{s?.total_items ?? 0}</span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                across {s?.branches ?? 0} branches
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Racks at capacity</span>
              <span
                className="text-title-1 tnum"
                style={{ color: (s?.racks_full ?? 0) > 0 ? 'var(--warning)' : undefined }}
              >
                {s?.racks_full ?? 0}
              </span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                85% full or over
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Zones out of range</span>
              <span
                className="text-title-1 tnum"
                style={{ color: (s?.zones_out_of_range ?? 0) > 0 ? 'var(--warning)' : undefined }}
              >
                {s?.zones_out_of_range ?? 0}
              </span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                drifting from setpoint
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Awaiting a claim</span>
              <span className="text-title-1 tnum">{s?.publicly_listed ?? 0}</span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                {s?.reserved ?? 0} reserved · {s?.escalated ?? 0} to partners · {s?.distributed ?? 0} picked up
                {(s?.in_transit ?? 0) > 0 ? ` · ${s?.in_transit} still in transit` : ''}
              </span>
            </GlassCard>
          </div>

          {(s?.unsupported_placements ?? 0) > 0 && (
            <GlassCard
              className="p-4 mb-5 flex items-start gap-2.5"
              style={{ borderColor: 'color-mix(in srgb, var(--critical) 40%, transparent)' }}
            >
              <AlertTriangle size={15} color="var(--critical)" style={{ marginTop: 1, flexShrink: 0 }} />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-body" style={{ fontWeight: 600 }}>
                  {s?.unsupported_placements} placement
                  {s?.unsupported_placements === 1 ? '' : 's'} in a zone the branch doesn&apos;t have
                </span>
                <span className="text-caption">
                  Stock is recorded in a storage type this branch has no allocation for. Expand the branch
                  below to see which items, and move or re-route them.
                </span>
              </div>
            </GlassCard>
          )}

          <div className="flex flex-col gap-4">
            {data.branches.map((branch) => (
              <GlassCard key={branch.branch_id} className="p-4 sm:p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="flex-shrink-0 rounded-sm"
                      style={{ width: 9, height: 9, background: branch.color }}
                    />
                    <span className="text-title-2 truncate">
                      {branch.branch_name.replace('Willing Hearts — ', '')}
                    </span>
                    <span className="text-caption" style={{ fontSize: 11 }}>
                      {branch.area}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {branch.has_cold_storage ? (
                      <span className="badge badge-info">
                        <Snowflake size={9} />
                        Cold storage
                      </span>
                    ) : (
                      <span className="badge badge-neutral">No chiller</span>
                    )}
                    {branch.has_cooking && <span className="badge badge-neutral">Kitchen</span>}
                    <span className="badge badge-neutral tnum">
                      {branch.current_load_kg}/{branch.capacity_kg}kg
                    </span>
                  </div>
                </div>

                <div className="grid-thirds" style={{ gap: 12 }}>
                  {branch.zones.map((zone) => (
                    <ZonePanel key={zone.key} zone={zone} onUpdated={fetchStorage} />
                  ))}
                </div>
              </GlassCard>
            ))}
          </div>

          <p className="text-caption mt-5" style={{ fontSize: 11 }}>
            Zone temperatures are modelled from each zone&apos;s setpoint and how full it is, not read from
            sensors — a fuller rack holds less cold air and drifts warmer. Zone sizes are derived from the
            branch&apos;s capacity and whether it has cold storage.
          </p>
        </>
      )}

      {!loading && !data && (
        <EmptyState
          icon={<Warehouse size={19} color="var(--text-tertiary)" />}
          title="Storage data unavailable"
          description="Could not load inventory. Check the connection and reload."
        />
      )}
    </AppShell>
  );
}
