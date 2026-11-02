import { Clock } from 'lucide-react';
import { formatWib } from '@/src/lib/tz';
import { t, type Locale } from '@/src/i18n';

/**
 * Marks data that may be out of date (PRD §16 "stale data states"), e.g. a need
 * assessment older than 30 days or a recommendation computed before inputs changed.
 * Renders nothing when fresh unless `always`. `now` must be the tenant clock.
 */
export function StaleBadge({
  asOf,
  now,
  staleAfterMinutes,
  stale,
  reason,
  always = false,
  tz,
  locale = 'id',
}: {
  asOf: Date | string;
  now?: Date | string;
  staleAfterMinutes?: number;
  /** Explicit staleness (e.g. revision changed); overrides the age check. */
  stale?: boolean;
  reason?: string;
  always?: boolean;
  tz?: string;
  locale?: Locale;
}) {
  const asOfDate = new Date(asOf);
  const isStale =
    stale ??
    (now !== undefined && staleAfterMinutes !== undefined
      ? new Date(now).getTime() - asOfDate.getTime() > staleAfterMinutes * 60_000
      : false);
  if (!isStale && !always) return null;
  const when = formatWib(asOfDate, { locale, tz });
  return (
    <span className={`badge ${isStale ? 'badge-monitor' : 'badge-neutral'}`} role={isStale ? 'status' : undefined}>
      <Clock size={11} aria-hidden="true" />
      {isStale ? `${t('common', 'state.stale', undefined, locale)} · ` : ''}
      {t('common', 'state.staleSince', { time: when }, locale)}
      {reason && <span className="lb-badge-reason"> — {reason}</span>}
    </span>
  );
}
