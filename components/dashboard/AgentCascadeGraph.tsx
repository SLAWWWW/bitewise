'use client';

import { useMemo } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Wrench } from 'lucide-react';
import type { PipelineEntry, CandidateScore, ExcludedBranchInfo } from '@/lib/types';

type NodeVariant =
  | 'source'
  | 'gate'
  | 'chosen'
  | 'considered'
  | 'excluded'
  | 'coordinator'
  | 'outcome'
  | 'plan'
  | 'plan-risk'
  | 'placeholder';

interface CascadeNodeData extends Record<string, unknown> {
  eyebrow: string;
  title: string;
  detail?: string;
  meta?: string;
  toolCalls?: number;
  variant: NodeVariant;
}

const VARIANT_STYLE: Record<NodeVariant, { border: string; eyebrowColor: string; dashed?: boolean }> = {
  source: { border: 'var(--text-primary)', eyebrowColor: 'var(--text-tertiary)' },
  gate: { border: 'var(--info)', eyebrowColor: 'var(--info)' },
  chosen: { border: 'var(--success)', eyebrowColor: 'var(--success)' },
  considered: { border: 'var(--warning)', eyebrowColor: 'var(--warning)' },
  excluded: { border: 'var(--text-tertiary)', eyebrowColor: 'var(--text-tertiary)', dashed: true },
  coordinator: { border: 'var(--accent)', eyebrowColor: 'var(--accent)' },
  outcome: { border: 'var(--success)', eyebrowColor: 'var(--success)' },
  plan: { border: 'var(--text-tertiary)', eyebrowColor: 'var(--text-tertiary)' },
  'plan-risk': { border: 'var(--warning)', eyebrowColor: 'var(--warning)' },
  placeholder: { border: 'var(--text-tertiary)', eyebrowColor: 'var(--text-tertiary)', dashed: true },
};

function CascadeNode({ data }: NodeProps) {
  const d = data as CascadeNodeData;
  const style = VARIANT_STYLE[d.variant];
  return (
    <div
      style={{
        width: 220,
        borderRadius: 12,
        background: 'var(--bg-surface)',
        border: `1px solid ${style.dashed ? 'var(--border-strong)' : 'var(--border-default)'}`,
        borderLeft: `3px solid ${style.border}`,
        borderStyle: style.dashed ? 'dashed' : 'solid',
        borderLeftStyle: 'solid',
        padding: '10px 12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: style.border, border: 'none', width: 6, height: 6 }} />
      <Handle type="source" position={Position.Right} style={{ background: style.border, border: 'none', width: 6, height: 6 }} />
      <div
        className="tnum"
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: style.eyebrowColor,
          marginBottom: 3,
        }}
      >
        {d.eyebrow}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.25 }}>
        {d.title}
      </div>
      {d.detail && (
        <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.35 }}>{d.detail}</div>
      )}
      <div className="flex items-center justify-between" style={{ marginTop: d.meta || d.toolCalls ? 6 : 0 }}>
        {d.meta && (
          <span className="tnum" style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)' }}>
            {d.meta}
          </span>
        )}
        {!!d.toolCalls && (
          <span
            className="flex items-center gap-1"
            style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}
          >
            <Wrench size={9} />
            {d.toolCalls}
          </span>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { cascade: CascadeNode };

const COL_W = 250;
const ROW_H = 96;

function col(n: number) {
  return n * COL_W;
}

/**
 * Visualizes one donation's full agent pipeline as a left-to-right cascade:
 * the listing → the food-safety gate → every candidate branch the Branch
 * Coordination Agents evaluated (fanning out, colored by outcome) →
 * converging on the Network Coordinator's pick → the demand-quota outcome →
 * the Supply Chain Planner's stages, chained in sequence. Every node reflects
 * real decision_details already computed server-side — nothing here is
 * invented for the visualization.
 */
export function AgentCascadeGraph({ entry }: { entry: PipelineEntry }) {
  const { nodes, edges } = useMemo(() => buildGraph(entry), [entry]);
  const dd = entry.decision_details;

  const maxRows = Math.max(1, dd.candidates.length + dd.excluded_branches.length);
  const height = Math.max(360, maxRows * ROW_H + 80);

  const toolCallCount =
    dd.candidates.reduce((s, c) => s + (c.tool_calls?.length ?? 0), 0) + (dd.supply_chain_plan?.tool_calls?.length ?? 0);
  const stats = [
    { label: 'Branches Evaluated', value: dd.candidates.length + dd.excluded_branches.length, color: 'var(--text-primary)' },
    { label: 'Chosen', value: entry.branch_name ? 1 : 0, color: 'var(--success)' },
    { label: 'Tool Calls', value: toolCallCount, color: 'var(--accent)' },
    { label: 'Plan Stages', value: dd.supply_chain_plan?.stages.length ?? 0, color: 'var(--text-secondary)' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <div
            className="tnum"
            style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}
          >
            Agent Cascade
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

      <div style={{ height, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
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
      detail: entry.donor?.name ?? 'Unknown donor',
      variant: 'source',
    } satisfies CascadeNodeData,
  });

  // ── Column 1: Sorting / Food-Safety Agent ─────────────────────────────
  const fsc = dd.food_safety_check;
  nodes.push({
    id: 'gate',
    type: 'cascade',
    position: { x: col(1), y: 0 },
    data: {
      eyebrow: 'Food-Safety Agent',
      title: fsc ? `${fsc.category_label}` : 'Safety check',
      detail: fsc ? fsc.reasoning : undefined,
      meta: fsc ? `${fsc.verdict.toUpperCase()} · ${fsc.score}/100` : undefined,
      variant: 'gate',
    } satisfies CascadeNodeData,
  });
  edges.push(edge('source-gate', 'source', 'gate', 'var(--info)'));

  // ── Column 2: Branch Coordination Agents (fan-out) ────────────────────
  const candidates = [...dd.candidates].sort((a, b) => b.total_score - a.total_score);
  const chosenId = dd.matched_branch_id;
  const rowsCol2 = candidates.length + dd.excluded_branches.length;
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
        detail: c.rationale,
        meta: `score ${c.total_score.toFixed(2)}`,
        toolCalls: c.tool_calls?.length,
        variant: isChosen ? 'chosen' : 'considered',
      } satisfies CascadeNodeData,
    });
    edges.push(edge(`gate-${id}`, 'gate', id, isChosen ? 'var(--success)' : 'var(--warning)'));
  });

  dd.excluded_branches.forEach((ex: ExcludedBranchInfo, i: number) => {
    const id = `excl-${ex.branch_id}`;
    nodes.push({
      id,
      type: 'cascade',
      position: { x: col(2), y: col2Top + (candidates.length + i) * ROW_H },
      data: {
        eyebrow: 'Excluded',
        title: ex.branch_name.replace('Willing Hearts — ', ''),
        detail: ex.reason,
        meta: `${ex.current_load_kg}/${ex.capacity_kg}kg`,
        variant: 'excluded',
      } satisfies CascadeNodeData,
    });
    edges.push(edge(`gate-${id}`, 'gate', id, 'var(--text-tertiary)', true));
  });

  // ── Column 3: Network Coordinator Agent (convergence) ─────────────────
  nodes.push({
    id: 'coordinator',
    type: 'cascade',
    position: { x: col(3), y: 0 },
    data: {
      eyebrow: 'Network Coordinator',
      title: entry.branch_name?.replace('Willing Hearts — ', '') ?? 'No branch matched',
      detail: dd.coordinator_rationale,
      meta: dd.used_ai_agents === false ? 'DETERMINISTIC' : 'AI-REVIEWED',
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
  const alloc = dd.beneficiary_allocation;
  nodes.push({
    id: 'outcome',
    type: 'cascade',
    position: { x: col(4), y: 0 },
    data: {
      eyebrow: 'Demand-Quota Allocation',
      title: alloc ? `Routed to ${alloc.beneficiary_name}` : 'Public listing',
      detail: alloc
        ? `${alloc.fulfilled_before_kg}/${alloc.daily_quota_kg}kg fulfilled before this donation`
        : 'No partner had unmet quota nearby — released to the public claim list.',
      meta: alloc ? `need ${alloc.need_score.toFixed(2)} · prox ${alloc.proximity_score.toFixed(2)}` : undefined,
      variant: 'outcome',
    } satisfies CascadeNodeData,
  });
  edges.push(edge('coordinator-outcome', 'coordinator', 'outcome', 'var(--success)'));

  // ── Columns 5+: Supply Chain Planner stages, chained in sequence ──────
  const plan = dd.supply_chain_plan;
  if (plan && plan.stages.length > 0) {
    let prev = 'outcome';
    plan.stages.forEach((stage, i) => {
      const id = `stage-${i}`;
      const hasRisk = !!stage.risk_note;
      nodes.push({
        id,
        type: 'cascade',
        position: { x: col(5 + i), y: 0 },
        data: {
          eyebrow: `Planner · ${stage.kind}`,
          title: stage.title,
          detail: stage.risk_note ?? stage.detail,
          meta: stage.timing,
          variant: hasRisk ? 'plan-risk' : 'plan',
        } satisfies CascadeNodeData,
      });
      edges.push(edge(`${prev}-${id}`, prev, id, hasRisk ? 'var(--warning)' : 'var(--text-tertiary)'));
      prev = id;
    });
  } else {
    nodes.push({
      id: 'no-plan',
      type: 'cascade',
      position: { x: col(5), y: 0 },
      data: {
        eyebrow: 'Supply Chain Planner',
        title: 'Plan not yet generated',
        detail: 'Open "Plan the supply chain" below to run this agent.',
        variant: 'placeholder',
      } satisfies CascadeNodeData,
    });
    edges.push(edge('outcome-no-plan', 'outcome', 'no-plan', 'var(--text-tertiary)', true));
  }

  return { nodes, edges };
}
