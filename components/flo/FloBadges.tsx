/** Status badges and derived-metric displays for the FLO pages (server- and client-safe). */
import type { ReactNode } from 'react';
import { t, type Locale } from '@/src/i18n';
import type { AgreementSummaryStatus, NeedBand, ResponseBand } from '@/src/application/flo/schemas';
import { fmt2, fmtNumeric } from './format';
import { categoryLabel } from '@/src/i18n/labels';

const AGREEMENT_TONE: Record<AgreementSummaryStatus, string> = {
  ACTIVE: 'badge-stable',
  EXPIRING_SOON: 'badge-monitor',
  SCHEDULED: 'badge-info',
  EXPIRED: 'badge-critical',
  PENDING: 'badge-accent',
  REVOKED: 'badge-critical',
  NONE: 'badge-neutral',
};

export function AgreementBadge({ status, locale }: { status: AgreementSummaryStatus; locale: Locale }) {
  return <span className={`badge ${AGREEMENT_TONE[status]}`}>{t('flo', `agreement.${status}`, undefined, locale)}</span>;
}

const VERSION_TONE: Record<string, string> = {
  ACTIVE: 'badge-stable',
  SCHEDULED: 'badge-info',
  PENDING_VERIFICATION: 'badge-accent',
  EXPIRED: 'badge-neutral',
  SUPERSEDED: 'badge-neutral',
  REJECTED: 'badge-critical',
  REVOKED: 'badge-critical',
};

export function VersionStatusBadge({ status, locale }: { status: string; locale: Locale }) {
  return <span className={`badge ${VERSION_TONE[status] ?? 'badge-neutral'}`}>{t('flo', `vstatus.${status}`, undefined, locale)}</span>;
}

const NEED_TONE: Record<NeedBand, string> = {
  HIGH: 'badge-urgent',
  MEDIUM: 'badge-monitor',
  LOW: 'badge-neutral',
  STALE: 'badge-neutral',
  MISSING: 'badge-neutral',
};

export function NeedSummary({
  band,
  score,
  category,
  locale,
}: {
  band: NeedBand;
  score: string | null;
  category: string | null;
  locale: Locale;
}) {
  if (band === 'MISSING') {
    return <span className="badge badge-neutral">{t('flo', 'need.MISSING', undefined, locale)}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tnum font-semibold">{fmtNumeric(score, locale)}</span>
      {category && <span className="text-caption">{categoryLabel(category, locale)}</span>}
      <span className={`badge ${NEED_TONE[band]}`}>
        {band === 'STALE' ? t('flo', 'need.STALE', undefined, locale) : t('flo', `needBand.${band}`, undefined, locale)}
      </span>
    </span>
  );
}

/**
 * A smoothed factor (R or E) with its sample count. With zero samples it reads
 * "Riwayat belum cukup" next to the neutral 0.50 — never a red zero (PRD §16).
 */
export function MetricValue({
  value,
  samples,
  band,
  locale,
}: {
  value: number;
  samples: number;
  band?: ResponseBand;
  locale: Locale;
}) {
  if (samples === 0) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="tnum text-[var(--text-secondary)]">{fmt2(value, locale)}</span>
        <span className="badge badge-neutral">{t('flo', 'metric.insufficient', undefined, locale)}</span>
      </span>
    );
  }
  const tone = band === 'LOW' ? 'badge-monitor' : band === 'HIGH' ? 'badge-stable' : 'badge-neutral';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tnum font-semibold">{fmt2(value, locale)}</span>
      <span className={`badge ${band ? tone : 'badge-neutral'}`}>{t('flo', 'metric.samples', { n: samples }, locale)}</span>
    </span>
  );
}

/** Label/value pair used in the profile and review panels (wraps on mobile). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption">{label}</dt>
      <dd className="text-body break-words text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}
