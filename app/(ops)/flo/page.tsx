import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AgreementBadge, MetricValue, NeedSummary } from '@/components/flo/FloBadges';
import { FloCreateForm } from '@/components/flo/FloCreateForm';
import { FloFilters } from '@/components/flo/FloFilters';
import { legalDate } from '@/components/flo/format';
import { withTx } from '@/src/db/tx';
import { isDomainError } from '@/src/db/errors';
import { makeT } from '@/src/i18n';
import { getLocale } from '@/src/i18n/server';
import { formatWib } from '@/src/lib/tz';
import { actorCtx, getServerActor } from '@/src/security/actor';
import { hasCap } from '@/src/security/capabilities';
import { listClusters, listFlos, type ClusterRef, type FloListResult, type FloListRow } from '@/src/application/flo/queries';
import { AGREEMENT_SUMMARY_STATUSES, floListQuery, type FloListFilters } from '@/src/application/flo/schemas';

export const metadata = { title: 'FLO — Lumbung' };

type SP = Record<string, string | string[] | undefined>;

function first(sp: SP): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined) out[k] = s;
  }
  return out;
}

function hrefWith(filters: FloListFilters, extra: Record<string, string | undefined> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) {
    if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `/flo?${qs}` : '/flo';
}

export default async function FloDirectoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const t = makeT('flo', locale);
  const tc = makeT('common', locale);
  const actor = await getServerActor();
  if (!actor) redirect('/masuk?next=/flo');

  if (!hasCap(actor, 'flo.read')) {
    return (
      <>
        <Header title={t('list.title')} />
        <EmptyState title={tc('state.unauthorised')} locale={locale} />
      </>
    );
  }

  const raw = first(await searchParams);
  const parsed = floListQuery.safeParse(raw);
  const query = parsed.success ? parsed.data : floListQuery.parse({});
  const { cursor, limit, ...filters } = query;

  let list: FloListResult;
  let clusters: ClusterRef[];
  try {
    [list, clusters] = await withTx(actorCtx(actor), async (c) => [
      await listFlos(c, filters, { cursor, limit }),
      await listClusters(c),
    ]);
  } catch (e) {
    const code = isDomainError(e) ? e.code : 'INTERNAL';
    return (
      <>
        <Header title={t('list.title')} />
        <ErrorState
          message={code === 'BAD_REQUEST' ? t('list.emptyBody') : tc('state.errorBody')}
          retryHref={code === 'BAD_REQUEST' ? '/flo' : undefined}
        />
      </>
    );
  }

  const nowText = formatWib(list.now, { locale, tz: list.timezone });
  const canEdit = hasCap(actor, 'flo.edit');

  const columns: Column<FloListRow>[] = [
    {
      key: 'code',
      header: t('col.code'),
      priority: 'primary',
      cell: (r) => (
        <span className="flex flex-col" style={{ minWidth: 180 }}>
          <span className="mono font-semibold" style={{ whiteSpace: 'nowrap' }}>{r.code}</span>
          <span className="text-body break-words">{r.name}</span>
        </span>
      ),
    },
    {
      key: 'type',
      header: t('col.type'),
      cell: (r) => (
        <span className="inline-flex flex-wrap gap-1.5">
          <span>{t(`type.${r.flo_type}`)}</span>
          {r.status === 'PAUSED' && <span className="badge badge-neutral">{t('status.PAUSED')}</span>}
          {r.tenure === 'NEW' && <span className="badge badge-info">{t('tenure.NEW')}</span>}
        </span>
      ),
    },
    {
      key: 'area',
      header: t('col.area'),
      cell: (r) => (
        <span className="flex flex-col">
          <span>{t(`area.${r.area}`)}</span>
          {r.primary_cluster && <span className="text-caption">{r.primary_cluster.name}</span>}
        </span>
      ),
    },
    {
      key: 'people',
      header: t('col.people'),
      align: 'end',
      hideOnMobile: true,
      cell: (r) =>
        r.people_per_event === null ? (
          '—'
        ) : (
          <span className="tnum">
            {r.people_per_event}
            {r.count_basis && <span className="block text-caption">{t(`basis.${r.count_basis}`)}</span>}
          </span>
        ),
    },
    {
      key: 'agreement',
      header: t('col.agreement'),
      cell: (r) => (
        <span className="flex flex-col gap-1 items-start">
          <AgreementBadge status={r.agreement.status} locale={locale} />
          {r.agreement.status === 'SCHEDULED' ? (
            <span className="text-caption">{t('agreement.startsOn', { date: legalDate(r.agreement.valid_from_date, locale) })}</span>
          ) : (
            r.agreement.valid_through_date && <span className="text-caption tnum">{legalDate(r.agreement.valid_through_date, locale)}</span>
          )}
          {r.agreement.has_pending_version && r.agreement.status !== 'PENDING' && (
            <span className="text-caption">{t('agreement.pendingVersion')}</span>
          )}
        </span>
      ),
    },
    {
      key: 'need',
      header: t('col.need'),
      cell: (r) => <NeedSummary band={r.need.band} score={r.need.score} category={r.need.category_code} locale={locale} />,
    },
    {
      key: 'response',
      header: t('col.response'),
      cell: (r) => <MetricValue value={r.response.value} samples={r.response.eligible} band={r.response.band} locale={locale} />,
    },
    {
      key: 'reporting',
      header: t('col.reporting'),
      cell: (r) => <MetricValue value={r.reporting.value} samples={r.reporting.n} locale={locale} />,
    },
  ];

  const nextHref = list.next_cursor ? hrefWith(filters, { cursor: list.next_cursor }) : null;

  return (
    <>
      <Header title={t('list.title')} subtitle={t('list.subtitle', { time: nowText })} />

      <nav aria-label={t('list.statusChips')} className="flex flex-wrap gap-2 mb-4">
        {AGREEMENT_SUMMARY_STATUSES.map((s) => (
          <Link
            key={s}
            href={hrefWith({ ...filters, agreement: filters.agreement === s ? undefined : s })}
            className={`badge ${filters.agreement === s ? 'badge-accent' : 'badge-neutral'}`}
            aria-current={filters.agreement === s ? 'true' : undefined}
          >
            {t(`agreement.${s}`)} · <span className="tnum">{list.agreement_counts[s]}</span>
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-4 min-w-0">
        <FloFilters filters={filters} clusters={clusters} locale={locale} />

        <p className="text-body" role="status">
          {t('list.count', { total: list.total, all: list.tenant_total })}
        </p>

        <DataTable
          caption={t('list.caption')}
          columns={columns}
          rows={list.items}
          rowKey={(r) => r.id}
          rowHref={(r) => `/flo/${r.id}`}
          rowLabel={(r) => `${r.code} ${r.name}`}
          locale={locale}
          empty={
            <EmptyState
              title={t('list.emptyTitle')}
              body={list.tenant_total === 0 ? t('list.emptyDirectory') : t('list.emptyBody')}
              locale={locale}
            />
          }
          footer={
            (cursor || nextHref) && (
              <div className="flex flex-wrap gap-3">
                {cursor && (
                  <Link href={hrefWith(filters)} className="btn btn-secondary">
                    {t('list.first')}
                  </Link>
                )}
                {nextHref && (
                  <Link href={nextHref} className="btn btn-secondary">
                    {t('list.next')}
                  </Link>
                )}
              </div>
            )
          }
        />

        {canEdit && (
          <details className="glass-card p-4 min-w-0">
            <summary className="text-title-2 cursor-pointer">{t('create.title')}</summary>
            <div className="mt-3">
              <FloCreateForm clusters={clusters.map((c) => ({ id: c.id, name: c.name, area: c.area }))} canEdit={canEdit} />
            </div>
          </details>
        )}
      </div>
    </>
  );
}
