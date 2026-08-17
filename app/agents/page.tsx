'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Bot, ChevronRight, Filter, Wrench, Users, Sparkles, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { SkeletonList, EmptyState } from '@/components/ui/Skeleton';
import { fetchJson } from '@/lib/utils/fetch-json';
import type { Decision } from '@/lib/types';

const PIPELINE = [
  {
    icon: Filter,
    title: 'Shortlist',
    body: 'A free, instant deterministic pass ranks every branch with capacity and keeps the top 3 — no AI spent on obvious non-fits.',
  },
  {
    icon: Wrench,
    title: 'Branch agents',
    body: 'Each shortlisted branch gets its own AI agent with 3 real function-calling tools. It decides when to call them, then writes its own verdict.',
  },
  {
    icon: Users,
    title: 'Coordinator',
    body: 'A second agent reads every branch report and makes the routing call — free to overrule the top score when the evidence justifies it.',
  },
];

/** Every decision links straight to that donation's own dedicated page — the
 *  full reasoning transcript there is identical, plus it shows the donation's
 *  *current* live status rather than freezing it at decision time. */
function DecisionCard({ decision }: { decision: Decision }) {
  const { details } = decision;
  const winner = details.candidates[0];
  const usedAi = details.used_ai_agents !== false;
  const content = (
    <div className="w-full flex items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex items-center justify-center rounded-lg flex-shrink-0"
          style={{ width: 32, height: 32, background: 'var(--bg-elevated)' }}
        >
          <Bot size={16} color={usedAi ? 'var(--accent)' : 'var(--warning)'} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-body truncate" style={{ fontWeight: 500 }}>
            {details.quantity_kg}kg {details.item_name}
          </span>
          <span className="text-caption truncate">
            {details.donor_name} → {details.matched_branch?.replace('Willing Hearts — ', '') ?? 'no branch'} ·{' '}
            {formatDistanceToNow(new Date(decision.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {usedAi && (
          <span className="badge badge-stable hidden sm:inline-flex">
            <Sparkles size={10} />
            AI
          </span>
        )}
        <span
          className="badge badge-accent tnum"
          title="A weighted composite of proximity, fairness, and stock safety — not a percentage. Realistic winning scores land between 0.2 and 0.5; this is the highest of the branches considered, not a low grade."
        >
          Score {(winner?.total_score ?? 0).toFixed(2)}
        </span>
        {decision.entity_id && <ChevronRight size={16} color="var(--text-secondary)" />}
      </div>
    </div>
  );

  if (!decision.entity_id) {
    return <GlassCard className="overflow-hidden">{content}</GlassCard>;
  }

  return (
    <Link href={`/item/${decision.entity_id}`} className="block">
      <GlassCard hover className="overflow-hidden cursor-pointer">
        {content}
      </GlassCard>
    </Link>
  );
}

export default function AgentsPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDecisions = useCallback(async () => {
    try {
      const data = await fetchJson<{ decisions: Decision[] }>('/api/audit');
      setDecisions(data.decisions ?? []);
    } catch {
      // Keep previous decisions on transient poll error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Polls so this stays in sync with approvals made from the /approvals page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 6000);
    return () => clearInterval(interval);
  }, [fetchDecisions]);

  return (
    <AppShell
      title="Agent Decisions"
      subtitle="Every routing decision, with the agents' real tool calls and reasoning preserved."
    >
      <div className="grid-thirds mb-5">
        {PIPELINE.map((step, i) => {
          const Icon = step.icon;
          return (
            <GlassCard key={step.title} className="p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center justify-center rounded-lg flex-shrink-0"
                  style={{ width: 26, height: 26, background: 'var(--bg-elevated)' }}
                >
                  <Icon size={14} color="var(--accent)" />
                </div>
                <span className="text-caption tnum" style={{ color: 'var(--text-tertiary)' }}>
                  0{i + 1}
                </span>
                <span className="text-title-2">{step.title}</span>
              </div>
              <p className="text-caption">{step.body}</p>
            </GlassCard>
          );
        })}
      </div>

      <div className="flex items-start gap-2 mb-2 text-caption">
        <ShieldCheck size={13} color="var(--success)" style={{ marginTop: 2, flexShrink: 0 }} />
        <span>
          If the model is ever unavailable, the identical formula runs with no AI involved so a live
          donation is never blocked — and any decision that fell back is labelled as such below.
        </span>
      </div>

      <div className="flex items-start gap-2 mb-5 text-caption" style={{ color: 'var(--text-tertiary)' }}>
        <Sparkles size={13} style={{ marginTop: 2, flexShrink: 0 }} />
        <span>
          Each score below blends proximity, fairness, and stock safety into one weighted number, capped
          at 1.0 — it&apos;s not a 0-100% quality grade, so a winning score of 0.2-0.5 is normal, not weak.
        </span>
      </div>

      {loading && <SkeletonList count={3} lines={1} />}

      {!loading && decisions.length === 0 && (
        <EmptyState
          icon={<Bot size={19} color="var(--text-tertiary)" />}
          title="No decisions logged yet"
          description="Approve a pending donation and its full agent transcript — every branch considered, every tool call, the coordinator's reasoning — is preserved here permanently."
        />
      )}

      <div className="flex flex-col gap-3">
        {decisions.map((decision) => (
          <DecisionCard key={decision.id} decision={decision} />
        ))}
      </div>
    </AppShell>
  );
}
