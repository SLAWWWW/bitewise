'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, PackageX } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton, EmptyState } from '@/components/ui/Skeleton';
import { ApprovalCard } from '@/components/dashboard/ApprovalCard';
import { FoodSafetyBadge } from '@/components/dashboard/FoodSafetyBadge';
import { SupplyChainPlan } from '@/components/dashboard/SupplyChainPlan';
import { AgentCascadeGraph } from '@/components/dashboard/AgentCascadeGraph';
import { BeneficiaryAllocationCard, JourneyCard, StageStepper, STEP_META } from '@/components/dashboard/DonationJourney';
import { fetchJson } from '@/lib/utils/fetch-json';
import type { PipelineEntry } from '@/lib/types';

const BACK_LINK = (
  <Link href="/orchestrator" className="btn btn-secondary flex items-center gap-1.5">
    <ArrowLeft size={14} />
    Network Overview
  </Link>
);

/**
 * One donation's whole story on its own page — reasoning, journey, supply
 * chain plan, everything. Replaces the old click-to-expand row: a dropdown
 * buried inside a list is confusing to navigate and easy to lose track of;
 * a dedicated URL is bookmarkable, linkable, and unambiguous about what
 * you're looking at.
 */
export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [entry, setEntry] = useState<PipelineEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchEntry = useCallback(async () => {
    try {
      const data = await fetchJson<{ entry: PipelineEntry }>(`/api/listings/${id}`);
      setEntry(data.entry);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEntry();
    const interval = setInterval(fetchEntry, 8000);
    return () => clearInterval(interval);
  }, [fetchEntry]);

  if (loading) {
    return (
      <AppShell title="Loading donation…" action={BACK_LINK}>
        <div className="flex flex-col gap-4">
          <Skeleton height={80} />
          <Skeleton height={280} />
        </div>
      </AppShell>
    );
  }

  if (notFound || !entry) {
    return (
      <AppShell title="Donation not found" action={BACK_LINK}>
        <EmptyState
          icon={<PackageX size={19} color="var(--text-tertiary)" />}
          title="This donation couldn't be found"
          description="It may have been removed, or the link is out of date."
        />
      </AppShell>
    );
  }

  const meta = STEP_META[entry.stage];
  const Icon = meta.icon;
  const branchLabel = entry.branch_name?.replace('Willing Hearts — ', '');

  return (
    <AppShell
      title={`${entry.quantity_kg}kg ${entry.item_name}`}
      subtitle={`${entry.donor?.name ?? 'Unknown donor'}${branchLabel ? ` → ${branchLabel}` : ''} · submitted ${formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}`}
      action={BACK_LINK}
    >
      <GlassCard className="p-5 flex items-center justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-center gap-2.5">
          <Icon size={17} color={meta.color} style={{ flexShrink: 0 }} />
          <span className="text-title-2" style={{ color: entry.stage === 'closed' ? 'var(--critical)' : meta.color }}>
            {entry.stage_label}
          </span>
        </div>
        <StageStepper stage={entry.stage} size="lg" />
      </GlassCard>

      {entry.stage === 'submitted' ? (
        <ApprovalCard listing={entry} onDecided={fetchEntry} />
      ) : entry.stage === 'closed' ? (
        <GlassCard className="p-5">
          <p className="text-body">
            {entry.status === 'cancelled'
              ? 'This donation was reviewed and rejected — no branch received it.'
              : 'This listing expired before it was reviewed.'}
          </p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-4">
          <JourneyCard entry={entry} onAdvanced={fetchEntry} />
          {entry.decision_details.candidates.length + entry.decision_details.excluded_branches.length > 0 && (
            <GlassCard className="p-5">
              <AgentCascadeGraph entry={entry} />
            </GlassCard>
          )}
          {entry.decision_details.food_safety_check && (
            <FoodSafetyBadge check={entry.decision_details.food_safety_check} />
          )}
          {entry.decision_details.beneficiary_allocation && (
            <BeneficiaryAllocationCard allocation={entry.decision_details.beneficiary_allocation} />
          )}
          <GlassCard className="p-5">
            <SupplyChainPlan
              listingId={entry.id}
              cachedPlan={entry.decision_details.supply_chain_plan}
              realStage={entry.stage}
            />
          </GlassCard>
        </div>
      )}
    </AppShell>
  );
}
