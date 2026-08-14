'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Truck,
  PackageCheck,
  Snowflake,
  Megaphone,
  AlarmClock,
  HeartHandshake,
  Route,
  Loader2,
  Check,
  AlertTriangle,
  Sparkles,
  ArrowDown,
  Users,
  Clock3,
  Wrench,
} from 'lucide-react';
import type { SupplyChainPlan as Plan, SupplyChainStageKind, PipelineStage } from '@/lib/types';

interface StreamStep {
  id: string;
  label: string;
  status: 'running' | 'done';
  note?: string;
}

const STAGE_ICON: Record<SupplyChainStageKind, typeof Truck> = {
  pickup: PackageCheck,
  transport: Truck,
  storage: Snowflake,
  listing: Megaphone,
  contingency: AlarmClock,
  delivery: HeartHandshake,
};

const STAGE_COLOR: Record<SupplyChainStageKind, string> = {
  pickup: 'var(--accent)',
  transport: 'var(--accent)',
  storage: 'var(--info)',
  listing: 'var(--success)',
  contingency: 'var(--warning)',
  delivery: 'var(--branch-3)',
};

// Where each kind of planned hop sits on the food's *physical* journey — used
// to compare the plan against the donation's real live stage, so the
// timeline shows what has actually happened, not just what was proposed.
const KIND_RANK: Record<SupplyChainStageKind, number> = {
  pickup: 1,
  transport: 2,
  storage: 3,
  listing: 4,
  delivery: 5,
  // Contingency is a conditional fallback, not a sequential hop — it should
  // never read as "reached" just because the food got as far as being
  // listed. Ranked above every real stage so it only ever shows as upcoming.
  contingency: 99,
};

// The donation's real stage (from /api/pipeline), on that same 0-5 scale.
const REAL_STAGE_RANK: Partial<Record<PipelineStage, number>> = {
  submitted: 0,
  approved: 0,
  collecting: 1,
  in_transit: 2,
  listed: 4,
  claimed: 5,
};

function stageState(kind: SupplyChainStageKind, realRank: number | null): 'done' | 'current' | 'upcoming' {
  if (realRank == null) return 'upcoming';
  const rank = KIND_RANK[kind] ?? 3;
  if (rank < realRank) return 'done';
  if (rank === realRank) return 'current';
  return 'upcoming';
}

/** The furthest planned stage the food has actually reached — what to show
 *  open by default, so tracking a donation takes zero clicks. */
function furthestReachedIndex(stages: Plan['stages'], realRank: number | null): number {
  if (realRank == null) return 0;
  let idx = -1;
  stages.forEach((s, i) => {
    if ((KIND_RANK[s.kind] ?? 3) <= realRank) idx = i;
  });
  return idx >= 0 ? idx : 0;
}

/** One clickable node per planned hop, connected by a fill line that tracks
 *  real progress — click any node to read what happens (or happened) there. */
function StageTimeline({
  stages,
  realRank,
  selectedIndex,
  onSelect,
}: {
  stages: Plan['stages'];
  realRank: number | null;
  selectedIndex: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="route-ribbon">
      <div className="scroll-x" style={{ paddingBottom: 4 }}>
        <div className="flex items-start" style={{ width: 'max-content' }}>
          {stages.map((stage, i) => {
            const Icon = STAGE_ICON[stage.kind] ?? Route;
            const color = STAGE_COLOR[stage.kind] ?? 'var(--accent)';
            const status = stageState(stage.kind, realRank);
            const selected = i === selectedIndex;
            return (
              <div key={i} className="flex items-start">
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  className="flex flex-col items-center gap-1.5"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', width: 88, flexShrink: 0, padding: '2px 0' }}
                  aria-pressed={selected}
                >
                  <div
                    className="flex items-center justify-center rounded-full flex-shrink-0"
                    style={{
                      width: 36,
                      height: 36,
                      background:
                        status === 'upcoming'
                          ? 'var(--bg-elevated)'
                          : `color-mix(in srgb, ${color} ${status === 'current' ? 22 : 16}%, var(--bg-elevated))`,
                      border: selected
                        ? `1.5px solid ${color}`
                        : `0.5px solid ${status === 'upcoming' ? 'var(--border-default)' : `color-mix(in srgb, ${color} 45%, transparent)`}`,
                      boxShadow: status === 'current' ? `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` : 'none',
                      opacity: status === 'upcoming' ? 0.55 : 1,
                      transition: 'all 200ms ease',
                    }}
                  >
                    {status === 'done' ? (
                      <Check size={15} color={color} />
                    ) : (
                      <Icon size={15} color={status === 'upcoming' ? 'var(--text-tertiary)' : color} />
                    )}
                  </div>
                  <span
                    className="text-caption text-center"
                    style={{
                      fontSize: 10.5,
                      lineHeight: 1.25,
                      color: selected ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {stage.title}
                  </span>
                </button>
                {i < stages.length - 1 && (
                  <div
                    style={{
                      height: 1.5,
                      flex: 1,
                      minWidth: 20,
                      marginTop: 17,
                      background: (KIND_RANK[stage.kind] ?? 3) < (realRank ?? 0) ? color : 'var(--border-default)',
                      transition: 'background 300ms ease',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StageDetail({ stage }: { stage: Plan['stages'][number] }) {
  const Icon = STAGE_ICON[stage.kind] ?? Route;
  const color = STAGE_COLOR[stage.kind] ?? 'var(--accent)';
  return (
    <div className="glass-card-nested p-3.5 flex flex-col gap-1.5 rise-in">
      <div className="flex items-center gap-2 flex-wrap">
        <Icon size={13} color={color} style={{ flexShrink: 0 }} />
        <span className="text-body" style={{ fontWeight: 600 }}>
          {stage.title}
        </span>
        <span className="badge badge-neutral" style={{ fontSize: 10 }}>
          <Clock3 size={9} />
          {stage.timing}
        </span>
      </div>
      {stage.location && (
        <span className="text-caption" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {stage.location}
        </span>
      )}
      <p className="text-caption">{stage.detail}</p>
      {stage.risk_note && (
        <div className="flex items-start gap-1.5 mt-0.5">
          <AlertTriangle size={11} color="var(--warning)" style={{ marginTop: 2, flexShrink: 0 }} />
          <span className="text-caption" style={{ color: 'var(--warning)', fontSize: 11 }}>
            {stage.risk_note}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * A donation's plan is generated once and cached permanently on the listing
 * (`decision_details.supply_chain_plan`) — so if the caller already has it,
 * render it immediately. Only a never-yet-planned listing shows the
 * "Plan the supply chain" action; viewing an existing plan costs no clicks.
 */
export function SupplyChainPlan({
  listingId,
  cachedPlan,
  realStage,
}: {
  listingId: string;
  /** Pass decision_details.supply_chain_plan if the caller already has it. */
  cachedPlan?: Plan | null;
  /** The donation's real current stage, if known — highlights live progress. */
  realStage?: PipelineStage;
}) {
  const [steps, setSteps] = useState<StreamStep[]>([]);
  const [plan, setPlan] = useState<Plan | null>(cachedPlan ?? null);
  const [state, setState] = useState<'idle' | 'streaming' | 'done' | 'error'>(cachedPlan ? 'done' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const realRank = realStage != null ? (REAL_STAGE_RANK[realStage] ?? null) : null;

  const run = useCallback(async () => {
    if (state === 'streaming') return;
    setState('streaming');
    setSteps([]);
    setPlan(null);
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`/api/agents/plan?listing_id=${listingId}`, { signal: ac.signal });
      if (!res.ok || !res.body) throw new Error('Could not reach the planner.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Parse the SSE frames as they arrive.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!evLine || !dataLine) continue;

          const event = evLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));

          if (event === 'step') {
            setSteps((prev) => {
              const next = [...prev];
              const at = next.findIndex((s) => s.id === data.id);
              if (at >= 0) next[at] = data;
              else next.push(data);
              return next;
            });
          } else if (event === 'plan' || event === 'cached') {
            setPlan(data.plan);
          } else if (event === 'error') {
            setError(data.message);
            setState('error');
          } else if (event === 'done') {
            setState((s) => (s === 'error' ? s : 'done'));
          }
        }
      }
      setState((s) => (s === 'error' ? s : 'done'));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError('The planner could not be reached.');
      setState('error');
    }
  }, [listingId, state]);

  if (state === 'idle') {
    return (
      <button type="button" className="btn btn-secondary flex items-center justify-center gap-2" onClick={run}>
        <Route size={15} />
        Plan the supply chain
      </button>
    );
  }

  const activeIndex = plan ? (selectedIndex ?? furthestReachedIndex(plan.stages, realRank)) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Live agent workflow — only shown while a *new* plan is generating. */}
      {(state === 'streaming' || steps.length > 0) && !plan && (
        <div className="glass-card-nested p-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            {state === 'streaming' ? (
              <Loader2 size={14} color="var(--accent)" className="animate-spin" />
            ) : (
              <Check size={14} color="var(--success)" />
            )}
            <span className="text-overline" style={{ color: 'var(--accent)' }}>
              Supply Chain Planner Agent
            </span>
          </div>

          {steps.map((s) => (
            <div key={s.id} className="flex items-start gap-2 rise-in">
              {s.status === 'running' ? (
                <Loader2 size={12} color="var(--accent)" className="animate-spin" style={{ marginTop: 3, flexShrink: 0 }} />
              ) : (
                <Check size={12} color="var(--success)" style={{ marginTop: 3, flexShrink: 0 }} />
              )}
              <span className="text-caption" style={{ minWidth: 0 }}>
                {s.label}
                {s.note && <span style={{ color: 'var(--text-tertiary)' }}> · {s.note}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-caption" style={{ color: 'var(--critical)' }}>
          <AlertTriangle size={13} style={{ marginTop: 2, flexShrink: 0 }} />
          {error}
        </div>
      )}

      {plan && (
        <div className="flex flex-col gap-4 rise-in">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-overline">Supply chain</span>
              {plan.generated_by_ai ? (
                <span className="badge badge-stable">
                  <Sparkles size={9} />
                  AI-planned
                </span>
              ) : (
                <span className="badge badge-urgent">
                  <AlertTriangle size={9} />
                  Deterministic fallback
                </span>
              )}
              <span className="badge badge-neutral tnum">{plan.total_window_hours}h window</span>
            </div>
            <p className="text-body">{plan.headline}</p>
          </div>

          <StageTimeline
            stages={plan.stages}
            realRank={realRank}
            selectedIndex={activeIndex}
            onSelect={setSelectedIndex}
          />

          <StageDetail stage={plan.stages[activeIndex]} />

          {/* Constraint tools the planner actually consulted. */}
          {plan.tool_calls && plan.tool_calls.length > 0 && (
            <div className="glass-card-nested scroll-x" style={{ padding: '8px 10px' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Wrench size={11} color="var(--text-tertiary)" />
                <span className="text-caption" style={{ fontSize: 10.5 }}>
                  Constraints checked
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {plan.tool_calls.map((call, i) => (
                  <div key={i} className="flex items-baseline gap-2" style={{ whiteSpace: 'nowrap' }}>
                    <span className="text-caption mono" style={{ color: 'var(--accent)', fontSize: 11 }}>
                      {call.name}()
                    </span>
                    <span className="text-caption mono" style={{ fontSize: 11 }}>
                      → {JSON.stringify(call.result)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contingency callout */}
          <div
            className="glass-card-nested p-3.5 flex items-start gap-2.5"
            style={{ borderColor: 'color-mix(in srgb, var(--branch-3) 35%, transparent)' }}
          >
            <HeartHandshake size={15} color="var(--branch-3)" style={{ marginTop: 1, flexShrink: 0 }} />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-overline" style={{ color: 'var(--branch-3)' }}>
                If nobody claims it
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-body" style={{ fontWeight: 600 }}>
                  {plan.contingency.beneficiary_name}
                </span>
                <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                  {plan.contingency.beneficiary_type}
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap text-caption" style={{ fontSize: 11 }}>
                <span className="flex items-center gap-1">
                  <ArrowDown size={10} />
                  {plan.contingency.trigger}
                </span>
                <span className="flex items-center gap-1">
                  <Truck size={10} />
                  {plan.contingency.minutes_from_branch} min away
                </span>
                <span className="flex items-center gap-1">
                  <Users size={10} />
                  serves ~{plan.contingency.serves}
                </span>
              </div>
              <p className="text-caption">{plan.contingency.rationale}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
