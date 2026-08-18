'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Wrench, X, ArrowDown } from 'lucide-react';
import { fitScore } from '@/lib/display-scoring';
import type { PipelineEntry, CandidateScore } from '@/lib/types';

type NodeVariant =
  | 'source'
  | 'gate'
  | 'chosen'
  | 'considered'
  | 'excluded'
  | 'coordinator'
  | 'outcome'
  | 'plan';

interface CascadeNodeData extends Record<string, unknown> {
  eyebrow: string;
  title: string;
  meta?: string;
  /** Explains meta's formula/units on hover — meta is often a raw score or
   *  bucketed value (e.g. "score 0.31", "72/100") that isn't self-evident. */
  metaTooltip?: string;
  toolCalls?: number;
  variant: NodeVariant;
  /** Full text shown only in the click-to-expand detail panel, never truncated. */
  detail?: string;
  /** DOM id of a fuller section already on this page — shown as a "jump to" link. */
  sectionId?: string;
  sectionLabel?: string;
  /** Extra lines for the detail panel (e.g. one per excluded branch). */
  lines?: string[];
}

const VARIANT_STYLE: Record<NodeVariant, { border: string; eyebrowColor: string; dashed?: boolean }> = {
  source: { border: 'var(--text-primary)', eyebrowColor: 'var(--text-tertiary)' },
  gate: { border: 'var(--info)', eyebrowColor: 'var(--info)' },
  chosen: { border: 'var(--success)', eyebrowColor: 'var(--success)' },
  considered: { border: 'var(--warning)', eyebrowColor: 'var(--warning)' },
  excluded: { border: 'var(--text-tertiary)', eyebrowColor: 'var(--text-tertiary)', dashed: true },
  coordinator: { border: 'var(--accent)', eyebrowColor: 'var(--accent)' },
  outcome: { border: 'var(--success)', eyebrowColor: 'var(--success)' },
  plan: { border: 'var(--text-secondary)', eyebrowColor: 'var(--text-secondary)' },
};

function CascadeNode({ data, selected }: NodeProps) {
  const d = data as CascadeNodeData;
  const style = VARIANT_STYLE[d.variant];
  return (
    <div
      style={{
        width: 220,
        borderRadius: 12,
        background: 'var(--bg-surface)',
        border: `1px solid ${selected ? style.border : style.dashed ? 'var(--border-strong)' : 'var(--border-default)'}`,
        borderLeft: `3px solid ${style.border}`,
        borderStyle: style.dashed ? 'dashed' : 'solid',
        borderLeftStyle: 'solid',
        padding: '10px 12px',
        boxShadow: selected ? `0 0 0 2px ${style.border}33` : '0 1px 3px rgba(0,0,0,0.04)',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: style.border, border: 'none', width: 6, height: 6 }} />
      <Handle type="source" position={Position.Right} style={{ background: style.border, border: 'none', width: 6, height: 6 }} />
      <div
        className="tnum"
        style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: style.eyebrowColor, marginBottom: 3 }}
      >
        {d.eyebrow}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.25 }}>
        {d.title}
      </div>
      {(d.meta || !!d.toolCalls) && (
        <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
          {d.meta && (
            <span
              className="tnum"
              style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)', cursor: d.metaTooltip ? 'help' : undefined }}
              title={d.metaTooltip}
            >
              {d.meta}
            </span>
          )}
          {!!d.toolCalls && (
            <span className="flex items-center gap-1" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              <Wrench size={9} />
              {d.toolCalls}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { cascade: CascadeNode };

const COL_W = 250;
const ROW_H = 96;
function col(n: number) {
  return n * COL_W;
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.style.transition = 'box-shadow 0.3s ease';
  el.style.boxShadow = '0 0 0 3px var(--accent)';
  setTimeout(() => {
    el.style.boxShadow = '';
  }, 1400);
}

/**
 * One donation's agent pipeline as a left-to-right cascade — only the
 * decisions themselves, not every underlying step: the listing → the
 * Food-Safety Agent's gate → each candidate branch the Branch Coordination
 * Agents evaluated (chosen vs. considered), with capacity-excluded branches
 * folded into one node rather than one each → the Network Coordinator's
 * pick → the demand-quota outcome → one summary node for the Supply Chain
 * Plan (its own full stage-by-stage timeline already lives further down
 * this page). Click any node for its full rationale; nodes tied to a
 * fuller section further down the page link straight to it.
 */
export function AgentCascadeGraph({ entry }: { entry: PipelineEntry }) {
  const { nodes, edges } = useMemo(() => buildGraph(entry), [entry]);
  const [selected, setSelected] = useState<CascadeNodeData | null>(null);
  const dd = entry.decision_details;

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    setSelected(node.data as CascadeNodeData);
  }, []);

  const candidateRows = dd.candidates.length + (dd.excluded_branches.length > 0 ? 1 : 0);
  const height = Math.max(320, candidateRows * ROW_H + 80);

  const toolCallCount =
    dd.candidates.reduce((s, c) => s + (c.tool_calls?.length ?? 0), 0) + (dd.supply_chain_plan?.tool_calls?.length ?? 0);
  const stats = [
    { label: 'Branches Evaluated', value: dd.candidates.length + dd.excluded_branches.length, color: 'var(--text-primary)' },
    { label: 'Chosen', value: entry.branch_name ? 1 : 0, color: 'var(--success)' },
    { label: 'Tool Calls', value: toolCallCount, color: 'var(--accent)' },
    { label: 'Plan Stages', value: dd.supply_chain_plan?.stages.length ?? 0, color: 'var(--text-secondary)' },
  ];

  return (
    <div style={{ position: 'relative' }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <div
            className="tnum"
            style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}
          >
            Workflow
          </div>
          <div className="text-title-2" style={{ marginTop: 2 }}>
            Decision flow for this donation
          </div>
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col items-end">
              <span
                className="tnum"
                style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}
              >
                {s.label}
              </span>
              <span className="tnum" style={{ fontSize: 18, fontWeight: 700, color: s.color, letterSpacing: '-0.02em' }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-caption" style={{ marginBottom: 10, color: 'var(--text-tertiary)' }}>
        Click any node for its full reasoning.
      </p>

      <div style={{ height, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.1}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--border-default)" gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>

      {selected && (
        <div
          role="dialog"
          aria-label={`${selected.eyebrow}: ${selected.title}`}
          style={{
            position: 'absolute',
            top: 60,
            right: 0,
            width: 300,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 12,
            padding: '14px 16px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
            zIndex: 10,
          }}
        >
          <div className="flex items-start justify-between gap-2" style={{ marginBottom: 6 }}>
            <div
              className="tnum"
              style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: VARIANT_STYLE[selected.variant].eyebrowColor }}
            >
              {selected.eyebrow}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="icon-btn"
              style={{ width: 22, height: 22, flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{selected.title}</div>
          {selected.detail && (
            <p className="text-caption" style={{ lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {selected.detail}
            </p>
          )}
          {selected.lines && selected.lines.length > 0 && (
            <ul style={{ marginTop: 6, paddingLeft: 16 }}>
              {selected.lines.map((line, i) => (
                <li key={i} className="text-caption" style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
                  {line}
                </li>
              ))}
            </ul>
          )}
          {selected.sectionId && (
            <button
              type="button"
              onClick={() => {
                scrollToSection(selected.sectionId!);
                setSelected(null);
              }}
              className="flex items-center gap-1.5"
              style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}
            >
              <ArrowDown size={12} />
              {selected.sectionLabel ?? 'View full details'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function buildGraph(entry: PipelineEntry): { nodes: Node[]; edges: Edge[] } {
  const dd = entry.decision_details;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const edge = (id: string, source: string, target: string, color: string, dashed = false): Edge => ({
    id,
    source,
    target,
    type: 'default',
    animated: false,
    style: { stroke: color, strokeWidth: 1.75, strokeDasharray: dashed ? '4 3' : undefined },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
  });

  // ── Column 0: the listing itself ──────────────────────────────────────
  nodes.push({
    id: 'source',
    type: 'cascade',
    position: { x: col(0), y: 0 },
    data: {
      eyebrow: 'Food Listing',
      title: `${entry.quantity_kg}kg ${entry.item_name}`,
      detail: `Donated by ${entry.donor?.name ?? 'an unknown donor'}. ${entry.decision_details.food_type} · submitted for review.`,
      variant: 'source',
    } satisfies CascadeNodeData,
  });

  // ── Column 1: Sorting / Food-Safety Agent ─────────────────────────────
  const fsc = dd.food_safety_check;
  // The score is deliberately vague ("a fixed band per verdict") — the ratio
  // is the actual number that decided good/warning/bad, so it's what
  // answers "why is this considered good?" rather than leaving that only
  // one click deeper on the item page's FoodSafetyBadge.
  const ratioLine =
    fsc && fsc.ratio > 0
      ? `Declared shelf life is ${fsc.ratio.toFixed(2)}× the safe window for ${fsc.category_label.toLowerCase()} in ${entry.storage_type} storage — ≤1.0× is 'good', up to 2.5× is 'warning', beyond that is 'bad'.`
      : fsc
        ? `${fsc.category_label} has no meaningful spoilage window at this storage type (e.g. canned or dry goods) — always rated good regardless of how long it's declared for.`
        : undefined;
  nodes.push({
    id: 'gate',
    type: 'cascade',
    position: { x: col(1), y: 0 },
    data: {
      eyebrow: 'Food-Safety Agent',
      title: fsc ? fsc.category_label : 'Safety check',
      meta: fsc ? `${fsc.verdict.toUpperCase()} · ${fsc.score}/100` : undefined,
      metaTooltip: fsc
        ? 'Score is informational only — a fixed band per verdict (good≈90, warning≈55, bad≈15) the AI can nudge within, never below the deterministic floor. Click the node for the actual number that decided the verdict.'
        : undefined,
      detail: fsc?.reasoning ?? 'This donation predates the automated safety-check feature.',
      lines: fsc
        ? [
            ratioLine!,
            `${fsc.perishable ? 'Perishable' : 'Shelf-stable'}${fsc.requires_cold_chain ? ' · needs cold chain' : ''} — ${fsc.safe_temp_note}`,
          ]
        : undefined,
      sectionId: fsc ? 'food-safety-section' : undefined,
      sectionLabel: 'View full safety check',
      variant: 'gate',
    } satisfies CascadeNodeData,
  });
  edges.push(edge('source-gate', 'source', 'gate', 'var(--info)'));

  // ── Column 2: Branch Coordination Agents (fan-out) ────────────────────
  // Only real candidates get their own node — branches filtered out by a
  // plain capacity check before any agent looked at them are folded into
  // one node instead of cluttering the graph with N near-identical dead ends.
  const candidates = [...dd.candidates].sort((a, b) => b.total_score - a.total_score);
  const chosenId = dd.matched_branch_id;
  const hasExcluded = dd.excluded_branches.length > 0;
  const rowsCol2 = candidates.length + (hasExcluded ? 1 : 0);
  const col2Top = -((rowsCol2 - 1) * ROW_H) / 2;

  candidates.forEach((c: CandidateScore, i: number) => {
    const id = `cand-${c.branch_id}`;
    const isChosen = c.branch_id === chosenId;
    nodes.push({
      id,
      type: 'cascade',
      position: { x: col(2), y: col2Top + i * ROW_H },
      data: {
        eyebrow: isChosen ? 'Chosen' : 'Considered',
        title: c.branch_name.replace('Willing Hearts — ', ''),
        meta: `fit ${fitScore(c.total_score)}/100`,
        metaTooltip:
          'Recalibrated onto a 0-100 scale (higher is better) from the real weighted composite (proximity×0.3 + fairness×0.5 + stock-safety×0.2) — the routing decision runs on the real numbers either way.',
        toolCalls: c.tool_calls?.length,
        detail: c.rationale ?? `Proximity ${c.proximity_score.toFixed(2)} · fairness ${c.fairness_score.toFixed(2)} · spoilage risk ${c.spoilage_risk_score.toFixed(2)}.`,
        variant: isChosen ? 'chosen' : 'considered',
      } satisfies CascadeNodeData,
    });
    edges.push(edge(`gate-${id}`, 'gate', id, isChosen ? 'var(--success)' : 'var(--warning)'));
  });

  if (hasExcluded) {
    const id = 'excluded-summary';
    nodes.push({
      id,
      type: 'cascade',
      position: { x: col(2), y: col2Top + candidates.length * ROW_H },
      data: {
        eyebrow: 'Excluded',
        title: `${dd.excluded_branches.length} branch${dd.excluded_branches.length === 1 ? '' : 'es'} at capacity`,
        detail: 'Filtered out before any agent evaluated them — already full for this donation.',
        lines: dd.excluded_branches.map(
          (ex) => `${ex.branch_name.replace('Willing Hearts — ', '')} — ${ex.current_load_kg}/${ex.capacity_kg}kg`
        ),
        variant: 'excluded',
      } satisfies CascadeNodeData,
    });
    edges.push(edge(`gate-${id}`, 'gate', id, 'var(--text-tertiary)', true));
  }

  // ── Column 3: Network Coordinator Agent (convergence) ─────────────────
  nodes.push({
    id: 'coordinator',
    type: 'cascade',
    position: { x: col(3), y: 0 },
    data: {
      eyebrow: 'Network Coordinator',
      title: entry.branch_name?.replace('Willing Hearts — ', '') ?? 'No branch matched',
      meta: dd.used_ai_agents === false ? 'DETERMINISTIC' : 'AI-REVIEWED',
      detail: dd.coordinator_rationale ?? 'Picked the top-scoring branch — no AI available to weigh in beyond the raw numbers.',
      variant: 'coordinator',
    } satisfies CascadeNodeData,
  });
  candidates.forEach((c) => {
    edges.push(
      edge(
        `${`cand-${c.branch_id}`}-coordinator`,
        `cand-${c.branch_id}`,
        'coordinator',
        c.branch_id === chosenId ? 'var(--success)' : 'var(--warning)'
      )
    );
  });

  // ── Column 4: demand-quota outcome ────────────────────────────────────
  // Checked in priority order, not just `beneficiary_allocation` alone —
  // that field only ever reflects a direct allocation decided AT APPROVAL
  // time. An item that started as a genuine public listing but was LATER
  // escalated (near-expiry, still unclaimed) and delivered to a partner has
  // no `beneficiary_allocation` at all — checking only that field used to
  // leave this node permanently reading "Public listing" even after the
  // item was actually delivered to a partner, since nothing else here ever
  // looked at what really happened to it.
  const alloc = dd.beneficiary_allocation;
  let outcomeTitle: string;
  let outcomeDetail: string;
  if (alloc) {
    outcomeTitle = `Routed to ${alloc.beneficiary_name}`;
    outcomeDetail = `${alloc.fulfilled_before_kg}/${alloc.daily_quota_kg}kg of this partner's daily quota was already fulfilled before this donation.`;
  } else if (entry.completed_via === 'partner_delivery') {
    outcomeTitle = 'Delivered to a partner organisation';
    outcomeDetail = 'Started as a public listing, went unclaimed close to its spoilage window, and was escalated and delivered to a partner beneficiary instead.';
  } else if (entry.completed_via === 'recycled') {
    outcomeTitle = 'Recycled — expired unclaimed';
    outcomeDetail = 'Went unclaimed past its safe shelf life and was sent for food-waste recycling rather than distributed.';
  } else if (entry.inventory_status === 'escalated') {
    outcomeTitle = 'Escalated to partner network';
    outcomeDetail = 'Started as a public listing, went unclaimed close to its spoilage window, and is now awaiting delivery to a partner beneficiary.';
  } else {
    outcomeTitle = 'Public listing';
    outcomeDetail = 'No partner beneficiary had unmet quota nearby, so this fell through to the public claim list.';
  }

  nodes.push({
    id: 'outcome',
    type: 'cascade',
    position: { x: col(4), y: 0 },
    data: {
      eyebrow: 'Demand-Quota Allocation',
      title: outcomeTitle,
      meta: alloc ? `need ${alloc.need_score.toFixed(2)} · prox ${alloc.proximity_score.toFixed(2)}` : undefined,
      metaTooltip: alloc
        ? 'Need = 1 − (kg already fulfilled ÷ daily quota), so lower means less need. Proximity = 1 ÷ (1 + minutes from branch ÷ 10), decaying with drive time. Neither is a percentage.'
        : undefined,
      detail: outcomeDetail,
      sectionId: alloc ? 'beneficiary-section' : undefined,
      sectionLabel: 'View partner allocation',
      variant: 'outcome',
    } satisfies CascadeNodeData,
  });
  edges.push(edge('coordinator-outcome', 'coordinator', 'outcome', 'var(--success)'));

  // ── Column 5: Supply Chain Plan — one summary node, not one per stage ──
  // The full stage-by-stage timeline (with its own tool-call traces and
  // stage-detail view) already lives in the Supply Chain Plan section
  // further down this same page — this node's job is to point there, not
  // to duplicate it.
  const plan = dd.supply_chain_plan;
  nodes.push({
    id: 'plan-summary',
    type: 'cascade',
    position: { x: col(5), y: 0 },
    data: {
      eyebrow: 'Supply Chain Planner',
      title: plan ? plan.headline : 'Plan not yet generated',
      meta: plan ? `${plan.stages.length} stages · ${plan.total_window_hours.toFixed(1)}h window` : undefined,
      toolCalls: plan?.tool_calls?.length,
      detail: plan
        ? undefined
        : 'Open "Plan the supply chain" further down this page to run this agent.',
      sectionId: 'plan-section',
      sectionLabel: plan ? 'View full stage-by-stage plan' : 'Go to planner',
      variant: 'plan',
    } satisfies CascadeNodeData,
  });
  edges.push(edge('outcome-plan', 'outcome', 'plan-summary', 'var(--text-secondary)'));

  return { nodes, edges };
}
