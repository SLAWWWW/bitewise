'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, ShieldAlert, Clock3, MapPin } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { CandidateBreakdown } from '@/components/dashboard/CandidateBreakdown';
import { FoodSafetyBadge } from '@/components/dashboard/FoodSafetyBadge';
import { SupplyChainPlan } from '@/components/dashboard/SupplyChainPlan';
import { fetchJson, FetchError } from '@/lib/utils/fetch-json';
import { describeShelfLife } from '@/lib/storage-zones';
import type { PendingListing } from '@/lib/types';

// Same tiers/thresholds as the Storage page (lib/storage-zones.ts) — a
// donation with hours left needs a visibly different badge than one that's
// good for a week, not the same "urgent" red on every single card regardless
// of how much time is actually left.
const URGENCY_BADGE: Record<string, string> = {
  expired: 'badge-critical',
  critical: 'badge-critical',
  urgent: 'badge-urgent',
  monitor: 'badge-neutral',
  stable: 'badge-neutral',
};

/**
 * The full approval card: reasoning breakdown, supply chain plan, Approve/Reject.
 * Shared between the dedicated /approvals queue and the Network Overview
 * dashboard's condensed panel — one implementation, so the two can never drift.
 */
export function ApprovalCard({ listing, onDecided }: { listing: PendingListing; onDecided: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const toast = useToast();
  const { decision_details: details } = listing;

  // With no eligible branch there is nothing to approve *to* — the API would
  // reject it with a 409, so don't offer the action in the first place.
  const canApprove = !!details.matched_branch_id && details.candidates.length > 0;

  async function handle(action: 'approve' | 'reject') {
    setBusy(action);
    try {
      const data = await fetchJson<{ success: boolean; message?: string; error?: string; matched_branch?: string; jain_index?: number }>(
        `/api/approvals/${listing.id}/${action}`,
        { method: 'POST' }
      );
      if (data.success) {
        toast(
          'success',
          action === 'approve'
            ? `Approved → ${data.matched_branch?.replace('Willing Hearts — ', '') ?? 'branch'}${
                data.jain_index != null ? ` · fairness now ${data.jain_index.toFixed(3)}` : ''
              }`
            : `Rejected ${listing.item_name}`
        );
        onDecided();
      } else {
        toast('error', data.message ?? data.error ?? 'That action failed — try again.');
        onDecided();
      }
    } catch (err) {
      if (err instanceof FetchError) {
        const body = err.body as Record<string, unknown> | null;
        toast('error', (body?.message as string) ?? (body?.error as string) ?? err.message);
        onDecided();
      } else {
        toast('error', 'Network error — check your connection and try again.');
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <GlassCard className="p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-title-1">
            {listing.quantity_kg}kg {listing.item_name}
          </span>
          <div className="flex items-center gap-1.5 text-caption flex-wrap">
            <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {listing.donor?.name ?? 'Unknown donor'}
            </strong>
            {listing.donor?.type && <span className="capitalize">· {listing.donor.type}</span>}
          </div>
          <div className="flex items-center gap-1.5 text-caption">
            <MapPin size={11} style={{ flexShrink: 0 }} />
            <span className="truncate">{listing.donor?.address ?? 'no address on file'}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {listing.donor?.status === 'pending' && <Badge variant="monitor">New donor</Badge>}
          <span className={`badge ${URGENCY_BADGE[describeShelfLife(listing.expiry_at).tier]}`}>
            <Clock3 size={10} />
            spoils {formatDistanceToNow(new Date(listing.expiry_at), { addSuffix: true })}
          </span>
          <span className="text-caption" style={{ fontSize: 11 }}>
            submitted {formatDistanceToNow(new Date(listing.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>

      {details.food_safety_check && <FoodSafetyBadge check={details.food_safety_check} />}

      <div style={{ borderTop: '0.5px solid var(--border-default)' }} />

      <CandidateBreakdown
        candidates={details.candidates}
        excludedBranches={details.excluded_branches}
        weights={details.weights}
        coordinatorRationale={details.coordinator_rationale}
        usedAiAgents={details.used_ai_agents}
      />

      {canApprove && (
        <>
          <div style={{ borderTop: '0.5px solid var(--border-default)' }} />
          <SupplyChainPlan listingId={listing.id} cachedPlan={details.supply_chain_plan} />
        </>
      )}

      <div className="flex items-center gap-1.5 text-caption">
        {listing.agreed_to_regulations ? (
          <>
            <CheckCircle2 size={12} color="var(--success)" style={{ flexShrink: 0 }} />
            Donor agreed to the donation guidelines
          </>
        ) : (
          <>
            <ShieldAlert size={12} color="var(--critical)" style={{ flexShrink: 0 }} />
            Donor did not confirm the donation guidelines
          </>
        )}
      </div>

      <div className="grid-halves">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null || !canApprove}
          onClick={() => handle('approve')}
          title={canApprove ? undefined : 'No branch has capacity for this donation yet'}
        >
          {busy === 'approve'
            ? 'Approving…'
            : canApprove
              ? `Approve → ${details.matched_branch?.replace('Willing Hearts — ', '')}`
              : 'No branch available'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy !== null}
          onClick={() => handle('reject')}
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </GlassCard>
  );
}
