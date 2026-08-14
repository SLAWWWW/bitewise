'use client';

import { useState } from 'react';
import { CheckCircle2, Ban, Bot, AlertTriangle, Wrench, ChevronRight, Sparkles } from 'lucide-react';
import type { CandidateScore, ExcludedBranchInfo, ToolCallTrace } from '@/lib/types';

// "Spoilage risk" reads as "how likely is this to spoil" — the opposite of what
// the score means. It's actually a glut check: 100% = this branch has none of
// this same food type about to expire, so it's the SAFEST outcome, not the
// riskiest. Renamed on-screen; the tooltip spells out the direction explicitly
// since a bare label can't fix that on its own.
const STOCK_SAFETY_TOOLTIP =
  'Higher is safer. Measures whether this branch already has other stock of the same food type about to expire — 100% means none does.';

function ScoreCell({
  label,
  value,
  distanceKm,
  title,
}: {
  label: string;
  value: number;
  distanceKm?: number;
  /** Native hover tooltip — for scores where a high number isn't intuitively "good". */
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-1" title={title}>
      <span className="text-overline candidate-metric-label" style={{ fontSize: 10 }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <div className="progress-track" style={{ width: 48, flexShrink: 0 }}>
          <div
            className="progress-fill"
            style={{ width: `${Math.min(100, value * 100)}%`, background: 'var(--accent)' }}
          />
        </div>
        <span className="text-caption tnum">{(value * 100).toFixed(0)}%</span>
      </div>
      {distanceKm != null && (
        <span className="text-caption" style={{ fontSize: 11 }}>
          {distanceKm}km away
        </span>
      )}
    </div>
  );
}

/** The actual function calls the agent made, with the values the tools returned.
 *  This is the audit trail that distinguishes a real tool-using agent from a
 *  model that was simply handed the numbers in its prompt. */
function ToolTrace({ calls }: { calls: ToolCallTrace[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-caption"
        style={{ cursor: 'pointer', width: 'fit-content', fontSize: 11 }}
      >
        <Wrench size={11} />
        {calls.length} tool {calls.length === 1 ? 'call' : 'calls'}
        <ChevronRight
          size={11}
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}
        />
      </button>

      {open && (
        <div className="glass-card-nested scroll-x" style={{ padding: '8px 10px' }}>
          <div className="flex flex-col gap-1.5">
            {calls.map((call, i) => (
              <div key={i} className="flex items-baseline gap-2" style={{ whiteSpace: 'nowrap' }}>
                <span
                  className="text-caption tnum"
                  style={{ color: 'var(--text-tertiary)', fontSize: 10 }}
                >
                  {i + 1}
                </span>
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
    </div>
  );
}

export function CandidateBreakdown({
  candidates,
  excludedBranches,
  weights,
  coordinatorRationale,
  usedAiAgents,
}: {
  candidates: CandidateScore[];
  excludedBranches: ExcludedBranchInfo[];
  weights: { proximity: number; fairness: number; spoilage: number };
  coordinatorRationale?: string;
  usedAiAgents?: boolean;
}) {
  const totalToolCalls = candidates.reduce((sum, c) => sum + (c.tool_calls?.length ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {usedAiAgents === false ? (
        <div
          className="flex items-start gap-2 glass-card-nested p-3"
          style={{ borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)' }}
        >
          <AlertTriangle size={14} color="var(--warning)" style={{ marginTop: 1, flexShrink: 0 }} />
          <span className="text-caption">
            AI agents were unavailable for this decision — the same deterministic formula was applied
            directly, so the routing is still correct.
          </span>
        </div>
      ) : (
        totalToolCalls > 0 && (
          <div className="flex items-center gap-1.5 text-caption" style={{ color: 'var(--success)' }}>
            <Sparkles size={13} />
            {candidates.length} branch agents ran · {totalToolCalls} verified tool calls
          </div>
        )
      )}

      <div className="flex flex-col gap-2">
        <span className="text-overline">Branch Coordination Agents</span>

        <div className="candidate-head text-overline" style={{ fontSize: 10 }}>
          <span>Branch</span>
          <span>Proximity</span>
          <span>Fairness need</span>
          <span title={STOCK_SAFETY_TOOLTIP} style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
            Stock safety
          </span>
          <span>Total</span>
        </div>

        <div className="flex flex-col gap-2">
          {candidates.map((c, i) => (
            <div
              key={c.branch_id}
              className="flex flex-col gap-2.5 p-3 rounded-lg"
              style={{
                background: i === 0 ? 'var(--bg-hover)' : 'transparent',
                border: i === 0 ? '0.5px solid var(--border-default)' : '0.5px solid transparent',
              }}
            >
              <div className="grid-candidate">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="flex-shrink-0 rounded-sm"
                    style={{ width: 8, height: 8, background: c.branch_color }}
                  />
                  <span className="text-body truncate" style={{ fontWeight: i === 0 ? 600 : 400 }}>
                    {c.branch_name.replace('Willing Hearts — ', '')}
                  </span>
                  {i === 0 && (
                    <span className="badge badge-stable" style={{ flexShrink: 0 }}>
                      <CheckCircle2 size={10} />
                      Chosen
                    </span>
                  )}
                </div>
                <ScoreCell label="Proximity" value={c.proximity_score} distanceKm={c.distance_km} />
                <ScoreCell label="Fairness need" value={c.fairness_score} />
                <ScoreCell label="Stock safety" value={c.spoilage_risk_score} title={STOCK_SAFETY_TOOLTIP} />
                <div className="flex flex-col gap-1">
                  <span className="text-overline candidate-metric-label" style={{ fontSize: 10 }}>
                    Total
                  </span>
                  <span className="text-title-2 tnum">{(c.total_score * 100).toFixed(0)}%</span>
                </div>
              </div>

              {c.rationale && (
                <div className="flex items-start gap-2">
                  <Bot
                    size={13}
                    color="var(--text-tertiary)"
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <p className="text-caption" style={{ fontStyle: 'italic', minWidth: 0 }}>
                    &ldquo;{c.rationale}&rdquo;
                  </p>
                </div>
              )}

              {c.tool_calls && c.tool_calls.length > 0 && <ToolTrace calls={c.tool_calls} />}
            </div>
          ))}

          {candidates.length === 0 && (
            <div className="flex items-start gap-2 glass-card-nested p-3">
              <AlertTriangle size={14} color="var(--critical)" style={{ marginTop: 1, flexShrink: 0 }} />
              <span className="text-caption">
                No branch was eligible — every branch is at capacity, so this donation can&apos;t be
                routed yet.
              </span>
            </div>
          )}
        </div>
      </div>

      {excludedBranches.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-overline">Not considered</span>
          {excludedBranches.map((e) => (
            <div key={e.branch_id} className="flex items-start gap-2 text-caption">
              <Ban size={12} color="var(--text-tertiary)" style={{ marginTop: 3, flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}>
                <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {e.branch_name.replace('Willing Hearts — ', '')}
                </strong>{' '}
                — {e.reason}
              </span>
            </div>
          ))}
        </div>
      )}

      {coordinatorRationale && (
        <div
          className="glass-card-nested p-3.5 flex items-start gap-2.5"
          style={{
            borderColor:
              usedAiAgents === false
                ? 'var(--border-default)'
                : 'color-mix(in srgb, var(--accent) 35%, transparent)',
          }}
        >
          <Bot
            size={15}
            color={usedAiAgents === false ? 'var(--text-tertiary)' : 'var(--accent)'}
            style={{ marginTop: 1, flexShrink: 0 }}
          />
          <div className="flex flex-col gap-1 min-w-0">
            {/* Don't credit a coordinator agent for a decision no agent made. */}
            <span
              className="text-overline"
              style={{ color: usedAiAgents === false ? 'var(--text-secondary)' : 'var(--accent)' }}
            >
              {usedAiAgents === false ? 'Routing decision' : 'Network Coordinator Agent — final call'}
            </span>
            <p className="text-body">{coordinatorRationale}</p>
          </div>
        </div>
      )}

      <p className="text-caption" style={{ fontSize: 11 }}>
        Score = {weights.proximity} × proximity + {weights.fairness} × fairness + {weights.spoilage} ×
        stock safety (higher is safer — no competing near-expiry stock of this food type at the branch).
        Each factor comes from a tool the branch&apos;s own agent called — expand any agent&apos;s tool
        calls above to see the raw values it received.
      </p>
    </div>
  );
}
