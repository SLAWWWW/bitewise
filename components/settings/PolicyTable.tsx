import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatWib } from '@/src/lib/tz';
import { makeT, type Locale } from '@/src/i18n';
import { summarizePolicyBody, type PolicyVersionRow } from '@/src/application/settings/queries';

const STATUS_BADGE: Record<PolicyVersionRow['status'], string> = {
  DRAFT: 'badge-neutral',
  APPROVED_DEMO: 'badge-info',
  APPROVED_LIVE: 'badge-stable',
  RETIRED: 'badge-neutral',
};

/** Policy body summary: weights first (e.g. ALLOC-DEMO-2.0), then scalar fields. */
export function PolicySummaryView({ body, locale }: { body: unknown; locale: Locale }) {
  const t = makeT('settings', locale);
  const s = summarizePolicyBody(body);
  if (s.empty) return <span className="text-caption">{t('policies.summary.empty')}</span>;
  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
      {s.weights.length > 0 && (
        <p className="text-caption">
          <span style={{ fontWeight: 600 }}>{t('policies.summary.weights')}:</span>{' '}
          {s.weights.map((w, i) => (
            <span key={w.key}>
              {i > 0 && ' · '}
              <span className="mono">{w.key}</span> <span className="tnum">{w.value}</span>
            </span>
          ))}
        </p>
      )}
      {s.fields.length > 0 && (
        <p className="text-caption">
          {s.fields.map((f, i) => (
            <span key={f.key}>
              {i > 0 && ' · '}
              <span className="mono">{f.key}</span>: {f.value}
            </span>
          ))}
        </p>
      )}
      {s.hidden > 0 && <p className="text-caption">{t('policies.summary.more', { count: s.hidden })}</p>}
    </div>
  );
}

export function PolicyTable({ policies, locale, tz }: { policies: PolicyVersionRow[]; locale: Locale; tz: string }) {
  const t = makeT('settings', locale);
  const columns: Column<PolicyVersionRow>[] = [
    {
      key: 'code',
      header: t('policies.col.code'),
      priority: 'primary',
      cell: (p) => (
        <span className="flex flex-col">
          <span className="mono">{p.code}</span>
          <span className="text-caption">{p.is_active ? t('policies.active') : t('policies.notActive')}</span>
        </span>
      ),
    },
    { key: 'kind', header: t('policies.col.kind'), cell: (p) => t(`policies.kind.${p.kind}`) },
    { key: 'version', header: t('policies.col.version'), cell: (p) => <span className="mono">{p.version}</span> },
    {
      key: 'status',
      header: t('policies.col.status'),
      cell: (p) => (
        <span className={`badge ${STATUS_BADGE[p.status]}`}>
          <span className="mono">{p.status}</span>
          <span className="sr-only"> — </span>
          <span> {t(`policies.status.${p.status}`)}</span>
        </span>
      ),
    },
    { key: 'summary', header: t('policies.col.summary'), cell: (p) => <PolicySummaryView body={p.body} locale={locale} /> },
    {
      key: 'live',
      header: t('policies.col.live'),
      cell: (p) =>
        p.live_allowed ? (
          <span className="text-caption">{t('policies.live.ok')}</span>
        ) : (
          <span className="text-caption" style={{ color: 'var(--critical)' }}>
            {t('policies.live.blocked', { status: p.status })}
          </span>
        ),
    },
    {
      key: 'approved',
      header: t('policies.col.approved'),
      hideOnMobile: true,
      cell: (p) =>
        p.approved_at ? (
          <span className="text-caption">
            {t('policies.approvedBy', {
              name: p.approved_by_name ?? '—',
              time: formatWib(p.approved_at, { locale, tz }),
            })}
          </span>
        ) : (
          <span className="text-caption">{t('policies.notApproved')}</span>
        ),
    },
  ];
  return (
    <DataTable
      caption={t('policies.caption')}
      columns={columns}
      rows={policies}
      rowKey={(p) => p.id}
      locale={locale}
      empty={<EmptyState title={t('policies.empty')} locale={locale} />}
    />
  );
}
