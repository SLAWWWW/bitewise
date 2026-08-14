import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

export function StatCard({
  label,
  value,
  suffix,
  icon: Icon,
  accent = 'var(--accent)',
  delta,
  deltaLabel,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  icon: LucideIcon;
  accent?: string;
  /** Optional change indicator, e.g. "+12%" */
  delta?: string;
  deltaLabel?: string;
}) {
  return (
    <GlassCard
      className="flex flex-col justify-between"
      style={{ padding: '22px 24px', minHeight: 120, minWidth: 0 }}
      hover
    >
      {/* Top row: label + icon — editorial left-align */}
      <div className="flex items-start justify-between gap-3">
        <span className="text-overline" style={{ paddingTop: 2 }}>{label}</span>
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{
            width: 34,
            height: 34,
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            color: accent,
            border: `0.5px solid color-mix(in srgb, ${accent} 20%, transparent)`,
          }}
        >
          <Icon size={15} strokeWidth={2} />
        </div>
      </div>

      {/* Value — massive, tightly tracked */}
      <div className="flex items-baseline gap-2 mt-3">
        <span className="text-display tnum" style={{ lineHeight: 1 }}>
          {typeof value === 'number' ? value.toLocaleString('en-SG') : value}
        </span>
        {suffix && (
          <span
            className="text-caption"
            style={{ color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.02em' }}
          >
            {suffix}
          </span>
        )}
      </div>

      {/* Delta indicator */}
      {delta && (
        <div className="flex items-center gap-1.5 mt-2">
          <span
            className="text-caption"
            style={{
              color: delta.startsWith('-') ? 'var(--critical)' : 'var(--success)',
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            {delta}
          </span>
          {deltaLabel && (
            <span className="text-caption" style={{ fontSize: 11 }}>{deltaLabel}</span>
          )}
        </div>
      )}
    </GlassCard>
  );
}
