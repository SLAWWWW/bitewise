import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField } from '@/components/ui/FormField';
import { LocalTime } from '@/components/ui/LocalTime';
import {
  auditFilterOptions,
  auditListQuery,
  listAuditEvents,
  type AuditEventItem,
  type AuditFilterOptions,
} from '@/src/application/audit/queries';
import { isDomainError } from '@/src/db/errors';
import { withTx } from '@/src/db/tx';
import { ACTOR_KINDS } from '@/src/db/types';
import { makeT } from '@/src/i18n';
import { getLocale } from '@/src/i18n/server';
import type { Page } from '@/src/http/pagination';
import { tzLabel } from '@/src/lib/tz';
import { actorCtx, getServerActor } from '@/src/security/actor';
import { hasCap } from '@/src/security/capabilities';

export async function generateMetadata() {
  return { title: `${makeT('audit', await getLocale())('title')} · Lumbung` };
}

const PAGE_SIZE = 50;
const FILTER_KEYS = ['subject_type', 'action', 'actor_id', 'actor_kind', 'subject_id', 'from', 'to'] as const;

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function hrefWith(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/audit?${s}` : '/audit';
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getServerActor();
  if (!actor) redirect('/masuk');
  const locale = await getLocale();
  const t = makeT('audit', locale);
  const tc = makeT('common', locale);
  const tz = actor.tenantTimezone;

  if (!hasCap(actor, 'audit.read')) {
    return (
      <>
        <Header title={t('title')} />
        <EmptyState title={tc('state.unauthorised')} body={t('unauthorised')} locale={locale} />
      </>
    );
  }

  const sp = await searchParams;
  const raw: Record<string, string | undefined> = {};
  for (const k of [...FILTER_KEYS, 'cursor'] as const) raw[k] = first(sp[k]);
  const parsed = auditListQuery.safeParse({ ...raw, limit: String(PAGE_SIZE) });
  const filters: Record<string, string | undefined> = {};
  for (const k of FILTER_KEYS) filters[k] = raw[k]?.trim() || undefined;

  let page: Page<AuditEventItem> | null = null;
  let options: AuditFilterOptions = { subjectTypes: [], actions: [], actors: [], actorKinds: [] };
  let invalid: string | null = null;
  try {
    const result = await withTx(actorCtx(actor), async (c) => {
      const opts = await auditFilterOptions(c);
      if (!parsed.success) return { opts, page: null };
      const { cursor, limit, ...f } = parsed.data;
      return { opts, page: await listAuditEvents(c, { ...f, cursor, limit }, tz) };
    });
    options = result.opts;
    page = result.page;
    if (!parsed.success) {
      invalid = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))].filter(Boolean).join(', ');
    }
  } catch (e) {
    if (isDomainError(e) && e.code === 'BAD_REQUEST') {
      invalid = 'cursor';
    } else {
      console.error('[audit] load failed', isDomainError(e) ? `${e.code}: ${(e.cause as Error | undefined)?.message ?? e.message}` : e);
      return (
        <>
          <Header title={t('title')} />
          <ErrorState title={t('error.title')} />
        </>
      );
    }
  }

  const hasFilters = FILTER_KEYS.some((k) => filters[k]);
  const actorName = (e: AuditEventItem) =>
    e.actor_name ?? (e.actor_id ? t('actor.unknownUser', { id: e.actor_id.slice(0, 8) }) : t(`actorKind.${e.actor_kind}`));

  const columns: Column<AuditEventItem>[] = [
    {
      key: 'time',
      header: t('col.time'),
      priority: 'primary',
      cell: (e) => <LocalTime value={e.occurred_at} tz={tz} locale={locale} seconds />,
    },
    {
      key: 'actor',
      header: t('col.actor'),
      cell: (e) => (
        <span className="flex flex-col">
          <span>{actorName(e)}</span>
          {(e.actor_name || e.actor_id) && <span className="text-caption">{t(`actorKind.${e.actor_kind}`)}</span>}
        </span>
      ),
    },
    { key: 'action', header: t('col.action'), cell: (e) => <span className="mono">{e.action}</span> },
    {
      key: 'subject',
      header: t('col.subject'),
      cell: (e) => (
        <span className="flex flex-col">
          <span className="mono">{e.subject_type}</span>
          {e.subject_id && (
            <span className="text-caption mono">
              {e.subject_id.slice(0, 8)}
              {e.subject_revision !== null && ` · ${t('subject.revision', { n: e.subject_revision })}`}
            </span>
          )}
        </span>
      ),
    },
    { key: 'reason', header: t('col.reason'), cell: (e) => e.reason ?? '—' },
    {
      key: 'policy',
      header: t('col.policy'),
      hideOnMobile: true,
      cell: (e) => (e.policy_code ? <span className="mono">{e.policy_code}</span> : '—'),
    },
    {
      key: 'correlation',
      header: t('col.correlation'),
      hideOnMobile: true,
      cell: (e) => (e.correlation_id ? <span className="mono text-caption">{e.correlation_id.slice(0, 12)}</span> : '—'),
    },
    {
      key: 'payload',
      header: t('col.payload'),
      hideOnMobile: true,
      cell: (e) =>
        e.payload && typeof e.payload === 'object' && Object.keys(e.payload as object).length > 0 ? (
          <details>
            <summary className="text-caption">{t('payload.show')}</summary>
            <pre className="mono text-caption" style={{ whiteSpace: 'pre-wrap', maxWidth: 360, overflowWrap: 'anywhere' }}>
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          </details>
        ) : (
          '—'
        ),
    },
  ];

  const selectAny = <option value="">{t('filter.any')}</option>;
  const cursor = raw.cursor;

  return (
    <div className="flex flex-col gap-5">
      <Header title={t('title')} subtitle={t('subtitle')} eyebrow={t('eyebrow')} />

      <form method="get" action="/audit" className="glass-card" style={{ padding: '18px 22px' }} aria-labelledby="audit-filter-legend">
        <h2 id="audit-filter-legend" className="text-title-2" style={{ marginBottom: 12 }}>
          {t('filter.legend')}
        </h2>
        <div className="grid-thirds">
          <FormField id="f-subject-type" label={t('filter.subjectType')} locale={locale}>
            <select className="input" name="subject_type" defaultValue={filters.subject_type ?? ''}>
              {selectAny}
              {options.subjectTypes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="f-action" label={t('filter.action')} locale={locale}>
            <select className="input" name="action" defaultValue={filters.action ?? ''}>
              {selectAny}
              {options.actions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="f-actor" label={t('filter.actor')} locale={locale}>
            <select className="input" name="actor_id" defaultValue={filters.actor_id ?? ''}>
              {selectAny}
              {options.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? t('actor.unknownUser', { id: a.id.slice(0, 8) })}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="f-actor-kind" label={t('filter.actorKind')} locale={locale}>
            <select className="input" name="actor_kind" defaultValue={filters.actor_kind ?? ''}>
              {selectAny}
              {ACTOR_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`actorKind.${k}`)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="f-from" label={t('filter.from')} hint={t('filter.dateHint')} locale={locale}>
            <input className="input" type="date" name="from" defaultValue={filters.from ?? ''} />
          </FormField>
          <FormField id="f-to" label={t('filter.to')} locale={locale}>
            <input className="input" type="date" name="to" defaultValue={filters.to ?? ''} />
          </FormField>
        </div>
        {filters.subject_id && <input type="hidden" name="subject_id" value={filters.subject_id} />}
        <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 14 }}>
          <button type="submit" className="btn btn-primary">
            {t('filter.apply')}
          </button>
          {hasFilters && (
            <Link href="/audit" className="btn btn-ghost">
              {t('filter.clear')}
            </Link>
          )}
          <span className="text-caption">{tzLabel(tz)} · {tz}</span>
        </div>
      </form>

      {invalid && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-body" style={{ color: 'var(--critical)' }}>
            {t('filter.invalid', { fields: invalid })}
          </p>
          <Link href={invalid === 'cursor' ? hrefWith(filters) : '/audit'} className="btn btn-secondary btn-sm">
            {invalid === 'cursor' ? t('page.first') : t('filter.clear')}
          </Link>
        </div>
      )}

      {page && (
        <section aria-label={t('caption')} className="flex flex-col gap-3">
          <DataTable
            caption={t('caption')}
            columns={columns}
            rows={page.items}
            rowKey={(e) => e.id}
            locale={locale}
            empty={<EmptyState title={hasFilters ? t('empty') : t('emptyAll')} locale={locale} />}
          />
          <nav className="flex flex-wrap items-center gap-3" aria-label={tc('table.rows', { count: page.items.length })}>
            {page.items.length > 0 && <span className="text-caption">{t('page.count', { count: page.items.length })}</span>}
            {cursor && (
              <Link href={hrefWith(filters)} className="btn btn-secondary btn-sm">
                {t('page.first')}
              </Link>
            )}
            {page.next_cursor ? (
              <Link href={hrefWith({ ...filters, cursor: page.next_cursor })} className="btn btn-secondary btn-sm" rel="next">
                {t('page.next')}
              </Link>
            ) : (
              page.items.length > 0 && <span className="text-caption">{t('page.end')}</span>
            )}
          </nav>
        </section>
      )}
    </div>
  );
}
