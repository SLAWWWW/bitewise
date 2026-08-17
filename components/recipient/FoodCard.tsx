'use client';

import { useEffect, useState } from 'react';
import {
  MapPin,
  Clock3,
  Snowflake,
  Box,
  Building2,
  Info,
  ChevronDown,
  Truck,
  PackageCheck,
  CheckCircle2,
  CalendarClock,
  Bookmark,
  Hourglass,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import type { PublicFoodItem } from '@/lib/types';

/** Ticks every second once a deadline is set; null before the client has a
 *  real clock reading, so there's nothing to mismatch between server and
 *  client on first paint. */
function useCountdown(deadline: string | null | undefined): number | null {
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMsLeft(null);
      return;
    }
    const target = new Date(deadline).getTime();
    const tick = () => setMsLeft(target - Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return msLeft;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** The agent-computed pickup deadline (§7.8), ticking live — this is what
 *  makes "reserved" mean something with teeth: let it run out and the item
 *  releases back to the public list on its own. */
function PickupCountdown({ deadline }: { deadline: string }) {
  const msLeft = useCountdown(deadline);
  if (msLeft === null) return null;

  const expired = msLeft <= 0;
  const critical = !expired && msLeft < 5 * 60_000;
  const color = expired ? 'var(--critical)' : critical ? 'var(--warning)' : 'var(--accent)';

  return (
    <div
      className="flex items-center gap-2 p-2.5 rounded-lg"
      style={{
        background: `color-mix(in srgb, ${color} 8%, var(--bg-elevated))`,
        border: `0.5px solid color-mix(in srgb, ${color} 32%, transparent)`,
      }}
    >
      <Hourglass size={13} color={color} style={{ flexShrink: 0 }} />
      <span className="text-caption tnum" style={{ color, fontWeight: 600 }}>
        {expired ? 'Pickup window closed — releasing shortly' : `${formatCountdown(msLeft)} left to collect`}
      </span>
    </div>
  );
}

const URGENCY_BADGE: Record<string, string> = {
  expired: 'badge-critical',
  critical: 'badge-critical',
  urgent: 'badge-urgent',
  monitor: 'badge-monitor',
  stable: 'badge-neutral',
};

const STAGE_ICON = {
  scheduled: CalendarClock,
  collecting: Truck,
  in_transit: PackageCheck,
  at_branch: CheckCircle2,
} as const;

const STAGE_COLOR = {
  scheduled: 'var(--text-secondary)',
  collecting: 'var(--monitor)',
  in_transit: 'var(--accent)',
  at_branch: 'var(--success)',
} as const;

/** Shows where the food physically is right now — collection scheduled, driver
 *  on the way, in transit, or on the shelf. */
function DeliveryTracker({ delivery }: { delivery: PublicFoodItem['delivery'] }) {
  const Icon = STAGE_ICON[delivery.stage];
  const color = STAGE_COLOR[delivery.stage];

  return (
      <div
        className="flex flex-col gap-2 p-3 rounded-lg"
        style={{
          background: `color-mix(in srgb, ${color} 8%, var(--bg-elevated))`,
          border: `0.5px solid color-mix(in srgb, ${color} 32%, transparent)`,
        }}
      >
        <div className="flex items-center gap-2">
          <Icon size={14} color={color} style={{ flexShrink: 0 }} aria-hidden="true" />
          <span className="text-body" style={{ fontWeight: 600, color }}>
            {delivery.label}
          </span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label={`Delivery progress: ${delivery.label}`}
          aria-valuenow={Math.round(delivery.fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="progress-fill"
            style={{ width: `${delivery.fraction * 100}%`, background: color }}
          />
        </div>
        <span className="text-caption" style={{ fontSize: 11 }}>
          {delivery.detail}
        </span>
      </div>
  );
}

export function FoodCard({
  item,
  onClaim,
  claiming,
  claimed,
}: {
  item: PublicFoodItem;
  onClaim: () => void;
  claiming: boolean;
  claimed: boolean;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const needsCold = item.storage_type === 'cold' || item.storage_type === 'frozen';
  const ready = item.delivery.collectable;
  const pickedUp = claimed && item.distributed;

  return (
    <GlassCard className="p-4 sm:p-5 flex flex-col gap-3.5">
      {/* Headline */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-title-2">{item.item_name}</span>
          <span className="text-caption capitalize">
            {item.food_type} · <span className="tnum">{item.quantity}</span>
            {item.unit === 'kg' ? 'kg' : ` ${item.unit}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {claimed && (
            <span className={`badge ${pickedUp ? 'badge-neutral' : 'badge-accent'}`}>
              {pickedUp ? <PackageCheck size={9} /> : <Bookmark size={9} />}
              {pickedUp ? 'Picked up' : 'Reserved by you'}
            </span>
          )}
          {!pickedUp && (
            <span className={`badge ${URGENCY_BADGE[item.urgency] ?? 'badge-neutral'} tnum`}>
              <Clock3 size={9} />
              {item.shelf_life_label}
            </span>
          )}
        </div>
      </div>

      {/* Where it is — once picked up, the "ready to collect" tracker is stale */}
      {!pickedUp && <DeliveryTracker delivery={item.delivery} />}

      {claimed && !pickedUp && item.pickup_deadline_at && (
        <PickupCountdown deadline={item.pickup_deadline_at} />
      )}

      {/* Key facts */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-1.5 text-caption flex-wrap">
          <MapPin size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ minWidth: 0, flex: 1 }}>
            Collect from{' '}
            <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {item.branch?.name.replace('Willing Hearts — ', '')}
            </strong>
            {item.branch?.area ? ` · ${item.branch.area}` : ''}
          </span>
        </div>

        <div className="flex items-start gap-1.5 text-caption flex-wrap">
          {needsCold ? (
            <Snowflake size={12} color="var(--info)" style={{ flexShrink: 0, marginTop: 2 }} />
          ) : (
            <Box size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          )}
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="capitalize">{item.storage_type}</span> storage — {item.storage_advice}
          </span>
        </div>

        {item.donated_by && (
          <div className="flex items-start gap-1.5 text-caption flex-wrap">
            <Building2 size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ minWidth: 0, flex: 1 }}>
              Donated by{' '}
              <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                {item.donated_by}
              </strong>
              {item.donor_type ? <span className="capitalize"> · {item.donor_type}</span> : null}
            </span>
          </div>
        )}
      </div>

      {/* Food safety detail, collapsed by default so the card stays scannable */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="flex items-center gap-1.5 text-caption"
          style={{ cursor: 'pointer', width: 'fit-content' }}
          aria-expanded={showDetail}
        >
          <Info size={12} />
          Food safety &amp; handling
          <ChevronDown
            size={12}
            style={{ transform: showDetail ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease' }}
          />
        </button>

        {showDetail && (
          <div className="glass-card-nested p-3 flex flex-col gap-2 rise-in">
            <p className="text-caption">{item.safety_note}</p>
            <div className="flex flex-col gap-1" style={{ borderTop: '0.5px solid var(--border-default)', paddingTop: 8 }}>
              <span className="text-caption" style={{ fontSize: 11 }}>
                Best before:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {new Date(item.expiry_at).toLocaleString('en-SG', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </strong>
              </span>
              {item.received_at && ready && (
                <span className="text-caption" style={{ fontSize: 11 }}>
                  At the branch since{' '}
                  {new Date(item.received_at).toLocaleString('en-SG', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action — wording depends on whether it's physically here yet, and
          whether the branch has already confirmed this recipient picked it up */}
      {pickedUp ? (
        <div
          className="flex items-center justify-center gap-2 text-caption p-2.5 rounded-lg"
          style={{ background: 'var(--bg-hover)', border: '0.5px solid var(--border-default)' }}
        >
          <PackageCheck size={13} color="var(--text-secondary)" />
          You picked this up — thank you for helping reduce food waste.
        </div>
      ) : (
        <button
          className="btn btn-primary"
          onClick={onClaim}
          disabled={claiming || claimed}
          aria-label={
            claimed
              ? ready
                ? `Claimed — collect ${item.item_name} at the branch`
                : `Reserved — ${item.item_name} will be held for you`
              : claiming
                ? `Saving claim for ${item.item_name}…`
                : ready
                  ? `Claim ${item.item_name}`
                  : `Reserve ${item.item_name} for collection`
          }
          aria-busy={claiming}
          title={ready ? undefined : 'Reserve now and collect once it reaches the branch'}
        >
          {claimed
            ? ready
              ? 'Claimed — collect at the branch'
              : 'Reserved — we’ll hold it for you'
            : claiming
              ? 'Saving…'
              : ready
                ? 'Claim this item'
                : 'Reserve for collection'}
        </button>
      )}

      {!ready && !claimed && (
        <span className="text-caption text-center" style={{ fontSize: 11 }}>
          You can reserve it now — it will be held for you once it arrives.
        </span>
      )}
    </GlassCard>
  );
}
