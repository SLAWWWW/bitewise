/** Holographic arc stroke when index is high; semantic colour otherwise */
function gaugeColor(index: number): string {
  if (index >= 0.8) return 'url(#gaugeGradient)';
  if (index >= 0.6) return 'var(--warning)';
  return 'var(--critical)';
}

function gaugeTextColor(index: number): string {
  if (index >= 0.8) return 'var(--success)';
  if (index >= 0.6) return 'var(--warning)';
  return 'var(--critical)';
}

const FORMULA_TOOLTIP =
  "Jain's Fairness Index: (Σ ratio)² ÷ (n × Σ ratio²), where ratio = each branch's current load ÷ its capacity. " +
  '1.0 = every branch is equally full relative to its own size; it falls toward 1/n as load concentrates in one branch. ' +
  "With zero load everywhere (no donations yet), every ratio is 0 and the formula is undefined (0÷0) — this shows 100% by " +
  "convention in that case (no imbalance exists yet), not because the network is actively balanced.";

export function FairnessGauge({
  jainIndex,
  branchCount,
  unitLabel = 'branches',
  totalLoadKg,
}: {
  jainIndex: number;
  branchCount: number;
  unitLabel?: string;
  /** When 0 (or omitted), the gauge shows the zero-donations caveat instead
   *  of implying an actively balanced network. */
  totalLoadKg?: number;
}) {
  const size = 148;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, jainIndex));
  const offset = circumference * (1 - clamped);
  const color = gaugeColor(clamped);
  const textColor = gaugeTextColor(clamped);
  const noDataYet = (totalLoadKg ?? 1) === 0;

  return (
    <div className="flex flex-col items-center gap-4" title={FORMULA_TOOLTIP}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Jain's Fairness Index: ${(clamped * 100).toFixed(0)}% across ${branchCount} ${unitLabel}${noDataYet ? ' — shown by convention, no donations yet' : ''}`}
        >
          <defs>
            {/* Accent arc gradient — only used when index ≥ 0.8 */}
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#0a84ff" />
              <stop offset="100%" stopColor="#6e5ce6" />
            </linearGradient>
          </defs>

          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={stroke}
          />

          {/* Fill arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.4,0,0.2,1), stroke 400ms ease' }}
          />
        </svg>

        {/* Centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
          <span
            className="tnum"
            style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em', color: textColor, lineHeight: 1 }}
          >
            {(clamped * 100).toFixed(0)}%
          </span>
          <span className="text-overline" style={{ marginTop: 4 }}>Fairness</span>
        </div>
      </div>

      {noDataYet ? (
        <p className="text-caption" style={{ textAlign: 'center', lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
          No donations yet — shown as 100% by convention, not an active measurement
        </p>
      ) : (
        <p className="text-caption" style={{ textAlign: 'center', lineHeight: 1.5 }}>
          Jain&apos;s Index across{' '}
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{branchCount}</span>{' '}
          {unitLabel}
        </p>
      )}
    </div>
  );
}
