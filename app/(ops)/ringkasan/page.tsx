import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LocalTime } from '@/components/ui/LocalTime';
import {
  FLO_AGREEMENT_BUCKETS,
  loadDashboard,
  type DashboardSnapshot,
  type FloAgreementBucket,
  type RenewalItem,
  type ReviewItem,
} from '@/src/application/dashboard/queries';
import { isDomainError } from '@/src/db/errors';
import { withTx } from '@/src/db/tx';
import { makeT } from '@/src/i18n';
import { getLocale } from '@/src/i18n/server';
import { formatLocalDate, formatRelative, tzLabel } from '@/src/lib/tz';
import { actorCtx, getServerActor } from '@/src/security/actor';
import { hasCap } from '@/src/security/capabilities';
import { CountTile, Section } from './_parts';
import {OperationsSummary} from '@/components/operations/OperationsSummary';
import { OperationsQueue } from '@/components/direct/OperationsQueue';

export async function generateMetadata() {
  return { title: `${makeT('dashboard', await getLocale())('title')} · Lumbung` };
}

const BUCKET_TONE: Record<FloAgreementBucket, 'neutral' | 'attention' | 'critical'> = {
  ACTIVE: 'neutral',
  EXPIRING: 'attention',
  SCHEDULED: 'neutral',
  EXPIRED: 'critical',
  REVOKED: 'critical',
  PENDING: 'attention',
  NONE: 'critical',
};

/** A local legal date labelled with the tenant zone ("31 Okt 2026 WIB"), PRD §16. */
function legalDateTz(date: string, locale: 'id' | 'en', tz: string): string {
  return `${formatLocalDate(date, locale)} ${tzLabel(tz)}`;
}

/** Legal last day ("31 Okt 2026 WIB") + time left to the exclusive end, against the tenant clock. */
function ThroughDate({
  through,
  until,
  now,
  locale,
  tz,
}: {
  through: string;
  until: string;
  now: string;
  locale: 'id' | 'en';
  tz: string;
}) {
  return (
    <span className="flex flex-col">
      <span>{legalDateTz(through, locale, tz)}</span>
      <time dateTime={until} className="text-caption">
        {formatRelative(until, now, locale)}
      </time>
    </span>
  );
}

export default async function RingkasanPage() {
  const actor = await getServerActor();
  if (!actor) redirect('/masuk');
  const locale = await getLocale();
  const t = makeT('dashboard', locale);
  const tz = actor.tenantTimezone;
  const canSeeFlo = hasCap(actor, 'flo.read');

  let snap: DashboardSnapshot;
  try {
    snap = await withTx(actorCtx(actor), (c) => loadDashboard(c));
  } catch (e) {
    console.error('[ringkasan] load failed', isDomainError(e) ? `${e.code}: ${(e.cause as Error | undefined)?.message ?? e.message}` : e);
    return (
      <>
        <Header title={t('title')} eyebrow={t('eyebrow')} />
        <ErrorState title={t('error.title')} />
      </>
    );
  }

  const simulated = actor.tenantMode !== 'LIVE';
  const nowIso = snap.now;
  const clockModeLabel = snap.clockMode ? makeT('common', locale)(`clock.${snap.clockMode}`) : '—';

  const reviewColumns: Column<ReviewItem>[] = [
    {
      key: 'flo',
      header: t('review.col.flo'),
      priority: 'primary',
      cell: (r) => (
        <span className="flex flex-col">
          <span className="mono">{r.flo_code}</span>
          <span className="text-caption">{r.flo_name}</span>
        </span>
      ),
    },
    {
      key: 'kind',
      header: t('review.col.kind'),
      cell: (r) => (
        <span className={`badge ${r.kind === 'REVOKED' ? 'badge-critical' : r.kind === 'PENDING' ? 'badge-info' : 'badge-monitor'}`}>
          {t(`review.kind.${r.kind}`)}
        </span>
      ),
    },
    { key: 'version', header: t('review.col.version'), cell: (r) => t('review.versionN', { n: r.version }) },
    {
      key: 'interval',
      header: t('review.col.interval'),
      cell: (r) =>
        t('review.interval', {
          from: formatLocalDate(r.valid_from_date, locale),
          through: legalDateTz(r.valid_through_date, locale, tz),
        }),
    },
    {
      key: 'ends',
      header: t('review.col.ends'),
      cell: (r) => (
        <ThroughDate through={r.valid_through_date} until={r.valid_until_exclusive} now={nowIso} locale={locale} tz={tz} />
      ),
    },
    {
      key: 'renewal',
      header: t('review.col.renewal'),
      cell: (r) => t(`review.renewal.${r.renewal_state ?? 'NA'}`),
    },
  ];

  const renewalColumns: Column<RenewalItem>[] = [
    {
      key: 'flo',
      header: t('renewal.col.flo'),
      priority: 'primary',
      cell: (r) => (
        <span className="flex flex-col">
          <span className="mono">{r.flo_code}</span>
          <span className="text-caption">{r.flo_name}</span>
        </span>
      ),
    },
    { key: 'offset', header: t('renewal.col.offset'), cell: (r) => t('renewal.offset', { days: r.offset_days }) },
    {
      key: 'due',
      header: t('renewal.col.due'),
      cell: (r) => <LocalTime value={r.due_at} tz={tz} locale={locale} relativeTo={nowIso} />,
    },
    {
      key: 'ends',
      header: t('renewal.col.ends'),
      cell: (r) => (
        <ThroughDate through={r.valid_through_date} until={r.valid_until_exclusive} now={nowIso} locale={locale} tz={tz} />
      ),
    },
  ];

  const reviewTotal = snap.review.pendingTotal + snap.review.expiringTotal + snap.review.revokedTotal;

  return (
    <div className="flex flex-col gap-5">
      <Header title={t('title')} subtitle={t('subtitle')} eyebrow={t('eyebrow')} />

      <div className="grid-halves">
        {simulated && (
          <section
            aria-labelledby="sim-title"
            className="glass-card"
            style={{ padding: '18px 22px', borderColor: 'var(--border-strong)' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-accent">{makeT('common', locale)(`mode.${actor.tenantMode}`)}</span>
              <h2 id="sim-title" className="text-title-2">
                {t(`sim.title.${actor.tenantMode}`)}
              </h2>
            </div>
            <p className="text-body" style={{ marginTop: 8 }}>
              {t('sim.body', { tenant: actor.tenantName })}
            </p>
          </section>
        )}
        <section aria-labelledby="clock-title" className="glass-card" style={{ padding: '18px 22px' }}>
          <h2 id="clock-title" className="text-overline">
            {t('clock.title')}
          </h2>
          <p className="text-title-1 tnum" style={{ marginTop: 6 }}>
            <LocalTime value={nowIso} tz={tz} locale={locale} />
          </p>
          <p className="text-caption" style={{ marginTop: 4 }}>
            {t('clock.mode', { mode: clockModeLabel })} · {t('clock.note')}
          </p>
        </section>
      </div>

      {canSeeFlo && (
        <Section
          id="flo-buckets"
          title={t('flo.title')}
          subtitle={
            <>
              {t('flo.subtitle')} <LocalTime value={nowIso} tz={tz} locale={locale} />. {t('flo.ineligibleNote')}
            </>
          }
          action={
            <Link href="/flo" className="btn btn-secondary btn-sm">
              {t('flo.openList')}
            </Link>
          }
        >
          <div className="grid-thirds">
            <CountTile label={t('flo.total')} value={snap.flo.total} unit={t('flo.unit')} locale={locale} />
            {FLO_AGREEMENT_BUCKETS.filter((b) => b !== 'SCHEDULED' || snap.flo.byBucket.SCHEDULED > 0).map((b) => (
              <CountTile
                key={b}
                label={t(`flo.bucket.${b}`)}
                value={snap.flo.byBucket[b]}
                unit={t('flo.unit')}
                hint={t(`flo.bucketHint.${b}`)}
                locale={locale}
                tone={snap.flo.byBucket[b] > 0 ? BUCKET_TONE[b] : 'neutral'}
              />
            ))}
          </div>
        </Section>
      )}

      {canSeeFlo && (
        <div className="flex flex-col gap-5">
          <Section
            id="agreement-review"
            title={t('review.title')}
            subtitle={t('review.subtitle')}
            action={
              <span className="flex flex-wrap gap-1.5">
                {snap.review.revokedTotal > 0 && (
                  <span className="badge badge-critical">
                    {t('review.revoked')}: <span className="tnum">{snap.review.revokedTotal}</span>
                  </span>
                )}
                <span className="badge badge-info">
                  {t('review.pending')}: <span className="tnum">{snap.review.pendingTotal}</span>
                </span>
                <span className="badge badge-monitor">
                  {t('review.expiring')}: <span className="tnum">{snap.review.expiringTotal}</span>
                </span>
              </span>
            }
          >
            <DataTable
              caption={t('review.caption')}
              columns={reviewColumns}
              rows={snap.review.items}
              rowKey={(r) => `${r.kind}:${r.agreement_id}`}
              rowHref={(r) => r.href}
              rowLabel={(r) => `${r.flo_code} ${r.flo_name}`}
              locale={locale}
              empty={<EmptyState title={t('review.empty')} locale={locale} />}
              footer={
                reviewTotal > snap.review.items.length ? (
                  <p className="text-caption">
                    {t('review.showing', { shown: snap.review.items.length, total: reviewTotal })}
                  </p>
                ) : undefined
              }
            />
          </Section>

          <Section
            id="renewal-tasks"
            title={t('renewal.title')}
            subtitle={t('renewal.subtitle')}
            action={
              <span className="badge badge-monitor">
                <span className="tnum">{snap.renewals.dueTotal}</span>&nbsp;{t('count.unit.task')}
              </span>
            }
          >
            <DataTable
              caption={t('renewal.caption')}
              columns={renewalColumns}
              rows={snap.renewals.items}
              rowKey={(r) => r.task_id}
              rowHref={(r) => r.href}
              rowLabel={(r) => `${r.flo_code} ${t('renewal.offset', { days: r.offset_days })}`}
              locale={locale}
              empty={<EmptyState title={t('renewal.empty')} locale={locale} />}
              footer={
                <>
                  {snap.renewals.dueTotal > snap.renewals.items.length && (
                    <p className="text-caption">
                      {t('review.showing', { shown: snap.renewals.items.length, total: snap.renewals.dueTotal })}
                    </p>
                  )}
                  {snap.renewals.upcomingTotal > 0 && (
                    <p className="text-caption">{t('renewal.upcoming', { count: snap.renewals.upcomingTotal })}</p>
                  )}
                </>
              }
            />
          </Section>
        </div>
      )}

      {canSeeFlo&&<OperationsQueue/>}
      {canSeeFlo&&<OperationsSummary/>}
    </div>
  );
}
