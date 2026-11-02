import { formatWib } from '@/src/lib/tz';
import { makeT, t as tr, type Locale } from '@/src/i18n';
import type { ActivationDecisionRow } from '@/src/application/settings/queries';
import type { TenantMode } from '@/src/shared/enums';

const STATUS_BADGE: Record<ActivationDecisionRow['status'], string> = {
  NOT_DECIDED: 'badge-monitor',
  APPROVED: 'badge-stable',
  MISSING: 'badge-critical',
};

/**
 * PRD §27 production readiness checklist. Each item shows the decision, the owner who
 * must confirm it, its status, the live capability it blocks, and an explicit
 * "live capability disabled: reason" line (never a silently hidden control).
 * Rendered as a list of cards (fits 390 px without horizontal scrolling).
 */
export function ReadinessChecklist({
  decisions,
  approvedCount,
  tenantMode,
  locale,
  tz,
}: {
  decisions: ActivationDecisionRow[];
  approvedCount: number;
  tenantMode: TenantMode;
  locale: Locale;
  tz: string;
}) {
  const t = makeT('settings', locale);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body" role="status">
        <span className="tnum" style={{ fontWeight: 600 }}>
          {t('readiness.summary', { approved: approvedCount, total: decisions.length })}
        </span>
      </p>
      <ol className="flex flex-col gap-2.5" aria-label={t('readiness.caption')}>
        {decisions.map((d, i) => {
          const title = t(`decision.${d.key}.title`);
          const owner = t(`decision.${d.key}.owner`);
          const capability = t(`decision.${d.key}.capability`);
          const reason =
            d.disabled_reason === 'NOT_DECIDED'
              ? t('readiness.reason.notDecided', { owner })
              : d.disabled_reason === 'MISSING'
                ? t('readiness.reason.missing')
                : d.disabled_reason === 'TENANT_NOT_LIVE'
                  ? t('readiness.reason.notLive', { mode: tr('common', `mode.${tenantMode}`, undefined, locale) })
                  : null;
          return (
            <li key={d.key} className="glass-card-nested" style={{ padding: '12px 14px', minWidth: 0 }} data-decision={d.key}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-body" style={{ fontWeight: 600, minWidth: 0 }}>
                  <span className="tnum text-caption" aria-hidden="true">
                    {i + 1}.{' '}
                  </span>
                  {title}
                </p>
                <span className={`badge ${STATUS_BADGE[d.status]}`}>
                  <span className="mono">{d.status === 'MISSING' ? 'NOT_DECIDED' : d.status}</span>
                  <span> · {t(`readiness.status.${d.status}`)}</span>
                </span>
              </div>
              <dl className="grid-halves" style={{ marginTop: 8, gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <dt className="text-overline">{t('readiness.col.owner')}</dt>
                  <dd className="text-caption">{owner}</dd>
                </div>
                <div style={{ minWidth: 0 }}>
                  <dt className="text-overline">{t('readiness.col.capability')}</dt>
                  <dd className="text-caption">{capability}</dd>
                </div>
              </dl>
              {d.live_enabled ? (
                <p className="text-caption" style={{ marginTop: 8, color: 'var(--success)' }}>
                  {t('readiness.enabled')}
                </p>
              ) : (
                <p className="text-caption" style={{ marginTop: 8, color: 'var(--critical)', fontWeight: 600 }} data-live-disabled>
                  {t('readiness.disabled', { capability, reason: reason ?? '' })}
                </p>
              )}
              {d.approved_at && (
                <p className="text-caption" style={{ marginTop: 4 }}>
                  {t('readiness.approvedBy', {
                    name: d.approved_by_name ?? '—',
                    time: formatWib(d.approved_at, { locale, tz }),
                  })}
                </p>
              )}
              {d.notes && (
                <p className="text-caption" style={{ marginTop: 4 }}>
                  {t('readiness.notes', { notes: d.notes })}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
