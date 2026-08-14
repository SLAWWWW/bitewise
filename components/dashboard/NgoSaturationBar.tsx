export function NgoSaturationBar({
  name,
  area,
  color,
  currentLoadKg,
  capacityKg,
}: {
  name: string;
  area?: string | null;
  color: string;
  currentLoadKg: number;
  capacityKg: number;
}) {
  const ratio = capacityKg > 0 ? currentLoadKg / capacityKg : 0;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const critical = pct >= 90;
  const warning = pct >= 70 && pct < 90;

  const fillColor = critical ? 'var(--critical)' : warning ? 'var(--warning)' : color;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
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
            className="truncate"
            style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}
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
          className="tnum flex-shrink-0"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: critical ? 'var(--critical)' : warning ? 'var(--warning)' : 'var(--text-secondary)',
            letterSpacing: '-0.01em',
          }}
        >
          {currentLoadKg.toLocaleString('en-SG')} / {capacityKg.toLocaleString('en-SG')} kg
          {' '}
          <span style={{ opacity: 0.55, fontWeight: 400 }}>({Math.round(pct)}%)</span>
        </span>
      </div>

      {/* Track */}
      <div
        className="progress-track"
        role="presentation"
        style={{ height: 4, borderRadius: 3 }}
      >
        <div
          className="progress-fill"
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 3,
            background: critical
              ? `linear-gradient(90deg, ${color}, var(--critical))`
              : warning
                ? `linear-gradient(90deg, ${color}, var(--warning))`
                : fillColor,
            boxShadow: critical || warning ? `0 0 8px ${fillColor}66` : undefined,
          }}
          role="progressbar"
          aria-label={`${name} storage saturation`}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
