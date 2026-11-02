import {MediaLink} from '@/components/operations/EvidenceForm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LocalTime } from '@/components/ui/LocalTime';
import { AgreementBadge, Field, VersionStatusBadge } from '@/components/flo/FloBadges';
import { AgreementUploadForm } from '@/components/flo/AgreementUploadForm';
import { ApproveAgreementAction, RevokeAgreementAction } from '@/components/flo/AgreementReviewActions';
import { daysBetween, legalDate } from '@/components/flo/format';
import { withTx } from '@/src/db/tx';
import { makeT } from '@/src/i18n';
import { getLocale } from '@/src/i18n/server';
import { formatWib } from '@/src/lib/tz';
import { isUuid } from '@/src/lib/uuidv5';
import { actorCtx, getServerActor } from '@/src/security/actor';
import { hasCap } from '@/src/security/capabilities';
import { getFlo, type AgreementVersion, type FloDetail } from '@/src/application/flo/queries';

export const metadata = { title: 'Perjanjian FLO — Lumbung' };

/** Approved versions whose effective [from, until) interval overlaps `a` (same rule as approve_agreement, 0015). */
function overlappingApproved(a: AgreementVersion, all: AgreementVersion[]): number[] {
  const from = Date.parse(a.valid_from);
  const until = Date.parse(a.valid_until_exclusive);
  return all
    .filter(
      (o) =>
        o.id !== a.id &&
        o.review_state === 'APPROVED' &&
        Date.parse(o.valid_from) < until &&
        from < Date.parse(o.effective_until),
    )
    .map((o) => o.version)
    .sort((x, y) => x - y);
}

const NOTICES = ['approved', 'revoked'] as const;

export default async function AgreementReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const noticeParam = Array.isArray(sp.notice) ? sp.notice[0] : sp.notice;
  const notice = (NOTICES as readonly string[]).includes(noticeParam ?? '') ? (noticeParam as (typeof NOTICES)[number]) : null;
  const noticeVersion = Number(Array.isArray(sp.v) ? sp.v[0] : sp.v);
  const locale = await getLocale();
  const t = makeT('flo', locale);
  const tc = makeT('common', locale);
  const actor = await getServerActor();
  if (!actor) redirect(`/masuk?next=/flo/${encodeURIComponent(id)}/perjanjian`);
  if (!hasCap(actor, 'flo.read')) return <EmptyState title={tc('state.unauthorised')} locale={locale} />;
  if (!isUuid(id)) notFound();

  let detail: FloDetail | null;
  try {
    detail = await withTx(actorCtx(actor), (c) => getFlo(c, id, { includeAudit: false }));
  } catch {
    return <ErrorState message={tc('state.errorBody')} />;
  }
  if (!detail) notFound();
  const d = detail;
  const tz = d.timezone;
  const canReview = hasCap(actor, 'agreement.review');
  const canUpload = hasCap(actor, 'agreement.upload');
  const nowText = formatWib(d.now, { locale, tz });

  const current = d.agreements.find((a) => a.status === 'ACTIVE') ?? null;
  const upcoming = d.agreements
    .filter((a) => a.status === 'SCHEDULED')
    .sort((x, y) => Date.parse(x.valid_from) - Date.parse(y.valid_from))[0];
  const pending = d.agreements.filter((a) => a.review_state === 'PENDING_VERIFICATION');
  const revocable = d.agreements.filter((a) => a.status === 'ACTIVE' || a.status === 'SCHEDULED');
  const versionOf = new Map(d.agreements.map((a) => [a.id, a.version]));

  const intervalCard = (a: AgreementVersion, title: string) => {
    const startText = formatWib(a.valid_from, { locale, tz });
    const endText = formatWib(a.valid_until_exclusive, { locale, tz });
    const left = daysBetween(d.now, a.valid_until_exclusive);
    return (
      <section className="glass-card p-4 sm:p-5 flex flex-col gap-3 min-w-0" aria-labelledby={`interval-${a.id}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`interval-${a.id}`} className="text-title-2">
            {title}
          </h2>
          <span>{t('word.version', { v: a.version })}</span>
          <VersionStatusBadge status={a.status} locale={locale} />
          {a.expiring_soon && <span className="badge badge-monitor">{t('rev.expiringBadge')}</span>}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('rev.legal')}>
            {t('rev.fromThrough', { from: legalDate(a.valid_from_date, locale, false), through: legalDate(a.valid_through_date, locale) })}
          </Field>
          <Field label={t('rev.exclusiveEnd')}>
            <LocalTime value={a.valid_until_exclusive} locale={locale} tz={tz} />
            {a.status === 'ACTIVE' && <span className="block text-caption">{t('rev.remaining', { days: Math.max(0, left) })}</span>}
          </Field>
          <Field label={t('rev.signed')}>{legalDate(a.signed_date, locale)}</Field>
        </dl>
        <p className="text-body">
          {t('rev.exclusiveExplain', { through: legalDate(a.valid_through_date, locale, false), start: startText, end: endText })}
        </p>
      </section>
    );
  };

  return (
    <>
      <Header
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href={`/flo/${d.profile.id}`} className="lb-link">
              ← {d.profile.code}
            </Link>
          </span>
        }
        title={`${t('rev.title')} — ${d.profile.name}`}
        subtitle={t('rev.subtitle', { time: nowText })}
        action={<AgreementBadge status={d.summary.agreement.status} locale={locale} />}
      />

      <div className="flex flex-col gap-4 min-w-0">
        {notice && (
          <p role="status" className="glass-card p-4 text-body text-[var(--success)]">
            {t(`rev.notice.${notice}`, { v: Number.isInteger(noticeVersion) ? noticeVersion : '?' })}
          </p>
        )}
        {current ? (
          intervalCard(current, t('rev.current'))
        ) : (
          <section className="glass-card p-4 sm:p-5 min-w-0" role="status">
            <p className="text-body">{t('rev.noCurrent', { time: nowText })}</p>
          </section>
        )}
        {upcoming && intervalCard(upcoming, t('rev.upcoming'))}

        <section className="glass-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
          <h2 className="text-title-2">{t('rev.renewals')}</h2>
          <DataTable
            caption={t('rev.renewals')}
            locale={locale}
            rows={d.renewal_tasks}
            rowKey={(r) => r.id}
            empty={<EmptyState title={t('rev.renewalsEmpty')} locale={locale} />}
            columns={[
              {
                key: 'offset',
                header: t('rev.reminder'),
                priority: 'primary',
                cell: (r) => (
                  <span>
                    {t('rev.renewalOffset', { days: r.offset_days })}{' '}
                    <span className="text-caption">{t('rev.renewalFor', { v: r.agreement_version })}</span>
                  </span>
                ),
              },
              {
                key: 'due',
                header: t('rev.renewalDue'),
                cell: (r) => <LocalTime value={r.due_at} locale={locale} tz={tz} relativeTo={d.now} />,
              },
              {
                key: 'status',
                header: t('rev.state'),
                cell: (r) => (
                  <span className="flex flex-col gap-1 items-start">
                    <span
                      className={`badge ${
                        r.status === 'OPEN' && Date.parse(r.due_at) <= Date.parse(d.now)
                          ? 'badge-monitor'
                          : r.status === 'DONE'
                            ? 'badge-stable'
                            : 'badge-neutral'
                      }`}
                    >
                      {t(`renewal.${r.status}`)}
                    </span>
                    {r.submitted_version !== null && (
                      <span className="text-caption">{t('rev.renewalSubmitted', { v: r.submitted_version })}</span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </section>

        {d.open_tasks.length > 0 && (
          <section className="glass-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
            <h2 className="text-title-2">{t('rev.tasks')}</h2>
            <ul className="flex flex-col gap-2">
              {d.open_tasks.map((task) => (
                <li key={task.id} className="glass-card-nested p-3 flex flex-wrap items-center gap-2 min-w-0">
                  <span className={`badge ${task.severity === 'HIGH' || task.severity === 'CRITICAL' ? 'badge-critical' : 'badge-monitor'}`}>
                    {t(`severity.${task.severity}`)}
                  </span>
                  <span className="text-body">{t(`task.${task.kind}`)}</span>
                  {typeof task.payload.reason === 'string' && <span className="text-caption break-words">— {task.payload.reason}</span>}
                  {task.due_at && <LocalTime value={task.due_at} locale={locale} tz={tz} className="text-caption" />}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="glass-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
          <h2 className="text-title-2">{t('rev.versions')}</h2>
          {pending.length > 0 && (
            <p className="text-body" role="note">
              {t('rev.pendingNote')}
            </p>
          )}
          <DataTable
            caption={t('rev.versions')}
            locale={locale}
            rows={d.agreements}
            rowKey={(a) => a.id}
            empty={<EmptyState title={t('agreement.NONE')} locale={locale} />}
            columns={[
              {
                key: 'version',
                header: t('rev.version'),
                priority: 'primary',
                cell: (a) => (
                  <span className="flex flex-col">
                    <span className="font-semibold">{t('word.version', { v: a.version })}</span>
                    {a.supersedes_id && versionOf.has(a.supersedes_id) && (
                      <span className="text-caption">{t('rev.supersedes', { v: versionOf.get(a.supersedes_id)! })}</span>
                    )}
                  </span>
                ),
              },
              {
                key: 'state',
                header: t('rev.state'),
                cell: (a) => (
                  <span className="inline-flex flex-wrap gap-1.5">
                    <VersionStatusBadge status={a.status} locale={locale} />
                    {a.expiring_soon && <span className="badge badge-monitor">{t('rev.expiringBadge')}</span>}
                  </span>
                ),
              },
              {
                key: 'interval',
                header: t('rev.interval'),
                cell: (a) => (
                  <span className="flex flex-col">
                    <span>
                      {t('rev.fromThrough', { from: legalDate(a.valid_from_date, locale, false), through: legalDate(a.valid_through_date, locale) })}
                    </span>
                    <span className="text-caption">
                      {t('rev.exclusiveEnd')}: {formatWib(a.valid_until_exclusive, { locale, tz })}
                    </span>
                    <span className="text-caption">
                      {a.end_date_interpretation && a.document_end_date
                        ? t(`rev.interp.${a.end_date_interpretation}`, { date: legalDate(a.document_end_date, locale) })
                        : t('rev.interpUnknown')}
                      {a.interpretation_note ? ` — ${a.interpretation_note}` : ''}
                    </span>
                    {a.superseded_from && (
                      <span className="text-caption">
                        {t('rev.cappedAt', { time: formatWib(a.superseded_from, { locale, tz }) })}
                      </span>
                    )}
                  </span>
                ),
              },
              { key: 'signed', header: t('rev.signed'), hideOnMobile: true, cell: (a) => legalDate(a.signed_date, locale) },
              {
                key: 'doc',
                header: t('rev.document'),
                hideOnMobile: true,
                cell: (a) => (a.document_media_id ? <MediaLink id={a.document_media_id}/> : t('rev.noDocument')),
              },
              {
                key: 'decision',
                header: t('rev.decision'),
                cell: (a) => (
                  <span className="flex flex-col">
                    <span className="text-caption">
                      {t('rev.uploadedBy')}: {a.uploaded_by_name ?? '—'}
                    </span>
                    {a.reviewed_at && (
                      <span className="text-caption">
                        {t('rev.reviewer')}: {a.reviewer_name ?? '—'} · {formatWib(a.reviewed_at, { locale, tz })}
                      </span>
                    )}
                    {a.revoked_at && (
                      <span className="text-caption text-[var(--critical)] break-words">
                        {t('rev.revokedReason', { time: formatWib(a.revoked_at, { locale, tz }), reason: a.revoke_reason ?? '' })}
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </section>

        <section className="glass-card p-4 sm:p-5 flex flex-col gap-4 min-w-0" aria-labelledby="reviewer-actions">
          <h2 id="reviewer-actions" className="text-title-2">
            {t('rev.actions')}
          </h2>
          {pending.length === 0 && revocable.length === 0 && <p className="text-body">{t('rev.noActions')}</p>}
          {pending.map((a) => (
            <div key={a.id} className="glass-card-nested p-4 flex flex-col gap-2 min-w-0">
              <p className="text-body">
                {t('word.version', { v: a.version })} ·{' '}
                {t('rev.fromThrough', { from: legalDate(a.valid_from_date, locale, false), through: legalDate(a.valid_through_date, locale) })}
              </p>
              <ApproveAgreementAction
                floId={d.profile.id}
                agreementId={a.id}
                version={a.version}
                revision={a.revision}
                overlappingVersions={overlappingApproved(a, d.agreements)}
                canReview={canReview}
              />
            </div>
          ))}
          {revocable.map((a) => (
            <div key={a.id} className="glass-card-nested p-4 flex flex-col gap-2 min-w-0">
              <p className="text-body">
                {t('word.version', { v: a.version })} · <VersionStatusBadge status={a.status} locale={locale} />
              </p>
              <RevokeAgreementAction floId={d.profile.id} agreementId={a.id} version={a.version} revision={a.revision} canReview={canReview} />
            </div>
          ))}
        </section>

        <AgreementUploadForm floId={d.profile.id} canUpload={canUpload} />
      </div>
    </>
  );
}
