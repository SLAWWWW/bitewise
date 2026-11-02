import type { ReactNode } from 'react';

/** Section card with a heading wired to aria-labelledby (server-safe). */
export function Section({
  id,
  title,
  subtitle,
  action,
  children,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="glass-card" style={{ padding: '20px 22px', minWidth: 0 }}>
      <div className="flex flex-wrap items-start justify-between gap-3" style={{ marginBottom: 14 }}>
        <div className="flex flex-col gap-1 min-w-0">
          <h2 id={id} className="text-title-2">
            {title}
          </h2>
          {subtitle && <p className="text-caption">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A count tile: label, exact integer, unit, one-line definition. No tooltips (no hover reliance). */
export function CountTile({
  label,
  value,
  unit,
  hint,
  locale,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  unit: string;
  hint?: string;
  locale: 'id' | 'en';
  tone?: 'neutral' | 'attention' | 'critical';
}) {
  const color =
    tone === 'critical' ? 'var(--critical)' : tone === 'attention' ? 'var(--warning)' : 'var(--text-primary)';
  return (
    <div className="glass-card-nested" style={{ padding: '14px 16px', minWidth: 0 }}>
      <p className="text-overline">{label}</p>
      <p className="flex items-baseline gap-1.5" style={{ marginTop: 6 }}>
        <span className="text-title-1 tnum" style={{ color, lineHeight: 1.1 }}>
          {value.toLocaleString(locale === 'en' ? 'en-GB' : 'id-ID')}
        </span>
        <span className="text-caption">{unit}</span>
      </p>
      {hint && (
        <p className="text-caption" style={{ marginTop: 6 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Placeholder for a later-stage queue: explicitly no number. */
export function NextStageTile({ label, stageText, badge, noData }: { label: string; stageText: string; badge: string; noData: string }) {
  return (
    <div className="glass-card-nested" style={{ padding: '14px 16px', minWidth: 0 }} aria-label={`${label} — ${stageText}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-overline">{label}</p>
        <span className="badge badge-neutral">{badge}</span>
      </div>
      <p className="text-body" style={{ marginTop: 8, color: 'var(--text-tertiary)' }}>
        {noData}
      </p>
      <p className="text-caption" style={{ marginTop: 2 }}>
        {stageText}
      </p>
    </div>
  );
}
