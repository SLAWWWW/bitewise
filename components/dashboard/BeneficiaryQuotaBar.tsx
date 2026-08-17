import { InfoTooltip } from '@/components/ui/InfoTooltip';

/** Per-beneficiary demand-quota fill — same track/fill markup as
 *  NgoSaturationBar, but inverted semantics: for branch storage, full is bad
 *  (near capacity); for a partner's daily quota, full is the goal (their
 *  registered need is actually being met). Low fill is what needs attention. */
export function BeneficiaryQuotaBar({
  name,
  area,
  quotaPct,
  fulfilledKg,
  quotaKg,
}: {
  name: string;
  area?: string | null;
  quotaPct: number;
  fulfilledKg: number;
  quotaKg: number;
}) {
  const pct = Math.max(0, Math.min(100, quotaPct));
  const underserved = pct < 40;
  const partial = pct >= 40 && pct < 80;

  const fillColor = underserved ? 'var(--critical)' : partial ? 'var(--warning)' : 'var(--success)';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2" style={{ minWidth: 0, flex: '1 1 220px' }}>
          <span
            aria-hidden="true"
            className="flex-shrink-0"
            style={{
              width: 7,
              height: 7,
              borderRadius: 2,
              background: fillColor,
              boxShadow: `0 0 6px ${fillColor}55`,
            }}
          />
          <span
            title={name}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
              overflowWrap: 'break-word',
            }}
          >
            {name}
          </span>
          {area && (
            <span className="text-caption flex-shrink-0" style={{ fontSize: 11 }}>
              · {area}
            </span>
          )}
        </div>

        <span
          className="tnum flex-shrink-0 flex items-center"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: underserved ? 'var(--critical)' : partial ? 'var(--warning)' : 'var(--success)',
            letterSpacing: '-0.01em',
          }}
        >
          {fulfilledKg.toLocaleString('en-SG')} / {quotaKg.toLocaleString('en-SG')} kg{' '}
          <span style={{ opacity: 0.55, fontWeight: 400 }}>({Math.round(pct)}%)</span>
          <InfoTooltip text="Kg already allocated to this partner today, ÷ their registered daily quota — 100% means fully served, the opposite of NgoSaturationBar's meaning above, where full is the branch running out of room." />
        </span>
      </div>

      <div className="progress-track" role="presentation" style={{ height: 4, borderRadius: 3 }}>
        <div
          className="progress-fill"
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 3,
            background: fillColor,
            boxShadow: underserved ? `0 0 8px ${fillColor}66` : undefined,
          }}
          role="progressbar"
          aria-label={`${name} daily quota fulfilled`}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
