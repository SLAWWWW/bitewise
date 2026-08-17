'use client';

import { useState } from 'react';
import {
  Inbox,
  CheckCircle2,
  Truck,
  PackageCheck,
  Store,
  HeartHandshake,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { useToast } from '@/components/ui/Toast';
import { fetchJson, FetchError } from '@/lib/utils/fetch-json';
import type { BeneficiaryAllocationDetails, PipelineEntry, PipelineStage } from '@/lib/types';

export const STEP_ORDER: PipelineStage[] = [
  'submitted',
  'approved',
  'collecting',
  'in_transit',
  'listed',
  'claimed',
];

export const STEP_META: Record<PipelineStage, { label: string; icon: typeof Inbox; color: string }> = {
  submitted: { label: 'Submitted', icon: Inbox, color: 'var(--monitor)' },
  approved: { label: 'Approved', icon: CheckCircle2, color: 'var(--accent)' },
  collecting: { label: 'Collecting', icon: Truck, color: 'var(--accent)' },
  in_transit: { label: 'In transit', icon: PackageCheck, color: 'var(--accent)' },
  listed: { label: 'Listed', icon: Store, color: 'var(--success)' },
  claimed: { label: 'Claimed', icon: HeartHandshake, color: 'var(--success)' },
  closed: { label: 'Closed', icon: XCircle, color: 'var(--critical)' },
};

// Matches FleetSummaryPanel's wording exactly — the same action shouldn't
// read differently depending on which surface a staffer happens to be on.
const NEXT_RUN_ACTION: Record<string, string> = {
  assigned: 'Mark en route',
  en_route: 'Mark picked up',
  picked_up: 'Complete',
};

/** A compact dot progress stepper for one donation's real journey — filled up
 *  to its current stage. Deliberately solid, not a gradient. */
export function StageStepper({ stage, size = 'sm' }: { stage: PipelineStage; size?: 'sm' | 'lg' }) {
  if (stage === 'closed') return null;
  const currentIndex = STEP_ORDER.indexOf(stage);
  const dot = size === 'lg' ? 8 : 6;
  const dotActive = size === 'lg' ? 20 : 14;
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {STEP_ORDER.map((s, i) => (
        <span
          key={s}
          style={{
            width: i === currentIndex ? dotActive : dot,
            height: dot,
            borderRadius: dot / 2,
            flexShrink: 0,
            background: i <= currentIndex ? STEP_META[stage].color : 'var(--border-strong)',
            transition: 'all 300ms ease',
          }}
        />
      ))}
    </div>
  );
}

/** Shown instead of/alongside the public listing story when this donation was
 *  routed straight to a partner beneficiary by demand-quota allocation at
 *  approval time — the real-world Willing Hearts/Food Bank mechanic, not the
 *  reactive 3-hour-unclaimed escalation. */
export function BeneficiaryAllocationCard({ allocation }: { allocation: BeneficiaryAllocationDetails }) {
  const quotaPct =
    allocation.daily_quota_kg > 0
      ? Math.round((allocation.fulfilled_before_kg / allocation.daily_quota_kg) * 100)
      : 0;
  return (
    <GlassCard
      variant="nested"
      className="p-3.5 flex flex-col gap-2"
      style={{ borderColor: 'color-mix(in srgb, var(--branch-3) 35%, transparent)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <HeartHandshake size={14} color="var(--branch-3)" style={{ flexShrink: 0 }} />
        <span className="text-overline" style={{ color: 'var(--branch-3)' }}>
          Routed to a partner beneficiary
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-body" style={{ fontWeight: 600 }}>
          {allocation.beneficiary_name}
        </span>
        <span className="badge badge-neutral" style={{ fontSize: 10 }}>
          {allocation.beneficiary_type.replace(/_/g, ' ')}
        </span>
      </div>
      <span className="text-caption" style={{ fontSize: 11 }}>
        Demand-quota allocation — this partner had <span className="tnum">{quotaPct}%</span> of today&apos;s{' '}
        <span className="tnum">{allocation.daily_quota_kg}kg</span> quota filled before this donation{' '}
        <span
          title="Need score = 1 − (kg already fulfilled ÷ daily quota), so lower means less need. Proximity score = 1 ÷ (1 + minutes from branch ÷ 10), so it decays with drive time — neither is a percentage."
          style={{ textDecoration: 'underline dotted', cursor: 'help' }}
        >
          (need score <span className="tnum">{allocation.need_score.toFixed(2)}</span>, proximity score{' '}
          <span className="tnum">{allocation.proximity_score.toFixed(2)}</span>)
        </span>
        .
      </span>
    </GlassCard>
  );
}

/** The donor → branch route plus live vehicle info and an inline advance
 *  action — everything about where the food physically is right now,
 *  without leaving this view for /logistics. */
export function JourneyCard({ entry, onAdvanced }: { entry: PipelineEntry; onAdvanced: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const openRun = entry.run_id && entry.run_status && NEXT_RUN_ACTION[entry.run_status];

  async function advance() {
    if (!entry.run_id) return;
    setBusy(true);
    try {
      const res = await fetchJson<{ success: boolean; status?: string; message?: string }>(
        `/api/fleet/${entry.run_id}/advance`,
        { method: 'POST', body: { action: 'advance' } }
      );
      if (res.success) {
        toast('success', `${entry.vehicle_label ?? 'Vehicle'} → ${String(res.status).replace('_', ' ')}`);
        onAdvanced();
      } else {
        toast('warning', res.message ?? 'Could not update that run.');
      }
    } catch (err) {
      toast('warning', err instanceof FetchError ? err.message : 'Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard variant="nested" className="p-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-caption min-w-0" style={{ color: 'var(--text-primary)' }}>
        <span className="truncate">{entry.donor?.name ?? 'Unknown donor'}</span>
        <ArrowRight size={11} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
        <span className="truncate">{entry.branch_name?.replace('Willing Hearts — ', '') ?? 'Unmatched'}</span>
        {entry.vehicle_label && (
          <span className="badge badge-accent mono flex-shrink-0">{entry.vehicle_label}</span>
        )}
      </div>
      {openRun && (
        <button
          type="button"
          className="btn btn-secondary flex-shrink-0"
          style={{ padding: '6px 12px', fontSize: 12 }}
          disabled={busy}
          onClick={advance}
        >
          {busy ? '…' : NEXT_RUN_ACTION[entry.run_status!]}
        </button>
      )}
    </GlassCard>
  );
}
