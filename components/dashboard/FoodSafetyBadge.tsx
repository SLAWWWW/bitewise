import { ShieldCheck, ShieldAlert, ShieldX, Bot } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { FoodSafetyCheckResult } from '@/lib/types';

const VERDICT_META: Record<FoodSafetyCheckResult['verdict'], { icon: typeof ShieldCheck; color: string; label: string }> = {
  good: { icon: ShieldCheck, color: 'var(--success)', label: 'Passed safety check' },
  warning: { icon: ShieldAlert, color: 'var(--warning)', label: 'Flagged for a closer look' },
  bad: { icon: ShieldX, color: 'var(--critical)', label: 'Failed safety check' },
};

/** The standardized safety verdict every listing now carries (PRD §7.7),
 *  shown to staff alongside the branch-routing reasoning so a 'warning'
 *  donation is visibly flagged at exactly the point a human decides whether
 *  to approve it — 'bad' never reaches this screen at all, it was rejected
 *  at submission. */
export function FoodSafetyBadge({ check }: { check: FoodSafetyCheckResult }) {
  const meta = VERDICT_META[check.verdict];
  const Icon = meta.icon;
  return (
    <div
      className="glass-card-nested p-3.5 flex flex-col gap-2"
      style={{ borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)` }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Icon size={14} color={meta.color} style={{ flexShrink: 0 }} />
        <span className="text-overline" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="flex items-center">
          <span className="badge badge-neutral tnum" style={{ fontSize: 10 }}>
            {check.score}/100
          </span>
          <InfoTooltip text="Not a precise measurement — a fixed band per verdict (good≈90, warning≈55, bad≈15) that the AI can nudge within that band, never below the deterministic floor for this category and storage type." />
        </span>
        {check.used_ai && (
          <span className="badge badge-accent" style={{ fontSize: 10 }}>
            <Bot size={9} />
            AI-reviewed
          </span>
        )}
      </div>
      <p className="text-caption">{check.reasoning}</p>
      <span className="text-caption" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        {check.category_label} · {check.perishable ? 'perishable' : 'shelf-stable'}
        {check.requires_cold_chain ? ' · needs cold chain' : ''} · {check.safe_temp_note}
      </span>
    </div>
  );
}
