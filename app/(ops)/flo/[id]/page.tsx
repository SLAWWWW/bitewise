import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LocalTime } from '@/components/ui/LocalTime';
import { StaleBadge } from '@/components/ui/StaleBadge';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { UnitQty } from '@/components/ui/UnitQty';
import { AgreementBadge, Field, MetricValue, NeedSummary, VersionStatusBadge } from '@/components/flo/FloBadges';
import { FloProfileForm } from '@/components/flo/FloProfileForm';
import { NeedConfirmButton } from '@/components/flo/NeedConfirmButton';
import { NeedProposalForm } from '@/components/flo/NeedProposalForm';
import { fmt2, fmtNumeric, legalDate } from '@/components/flo/format';
import { withTx } from '@/src/db/tx';
import { makeT, type Locale } from '@/src/i18n';
import { getLocale } from '@/src/i18n/server';
import { categoryLabel, serviceModelLabel } from '@/src/i18n/labels';
import { formatWib } from '@/src/lib/tz';
import { isUuid } from '@/src/lib/uuidv5';
import { actorCtx, getServerActor } from '@/src/security/actor';
import { hasCap } from '@/src/security/capabilities';
import { getFlo, listCategories, type CategoryRef, type FloDetail } from '@/src/application/flo/queries';

const TAB_IDS = ['profil', 'kebutuhan', 'riwayat', 'kinerja', 'perjanjian', 'audit'] as const;
type TabId = (typeof TAB_IDS)[number];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `FLO ${id.slice(0, 8)} — Lumbung` };
}

export default async function FloDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = makeT('flo', locale);
  const tc = makeT('common', locale);
  const actor = await getServerActor();
  if (!actor) redirect(`/masuk?next=/flo/${encodeURIComponent(id)}`);
  if (!hasCap(actor, 'flo.read')) {
    return <EmptyState title={tc('state.unauthorised')} locale={locale} />;
  }
  if (!isUuid(id)) notFound();

  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const active: TabId = (TAB_IDS as readonly string[]).includes(tabParam ?? '') ? (tabParam as TabId) : 'profil';

  let detail: FloDetail | null;
  let categories: CategoryRef[];
  try {
    [detail, categories] = await withTx(actorCtx(actor), async (c) => [
      await getFlo(c, id, { revealContacts: hasCap(actor, 'flo.edit'), includeAudit: hasCap(actor, 'audit.read') }),
      await listCategories(c),
    ]);
  } catch {
    return <ErrorState message={tc('state.errorBody')} />;
  }
  if (!detail) notFound();

  const d = detail;
  const s = d.summary;
  const tz = d.timezone;
  const nowText = formatWib(d.now, { locale, tz });

  const tabs = TAB_IDS.map((tabId) => ({
    id: tabId,
    label: t(`tab.${tabId}`),
    badge:
      tabId === 'perjanjian' && d.agreements.some((a) => a.review_state === 'PENDING_VERIFICATION')
        ? d.agreements.filter((a) => a.review_state === 'PENDING_VERIFICATION').length
        : tabId === 'kebutuhan' && d.needs.some((n) => n.freshness === 'PENDING')
          ? d.needs.filter((n) => n.freshness === 'PENDING').length
          : undefined,
  }));

  return (
    <>
      {hasCap(actor,'flo.edit')&&<Link className="lb-link" href={`/flo/${id}/operasi`}>{makeT('ops',locale)('settingsFlo')} →</Link>}
      <Header
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href="/flo" className="lb-link">
              ← {t('detail.back')}
            </Link>
            <span className="mono">{d.profile.code}</span>
          </span>
        }
        title={d.profile.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{t(`type.${d.profile.flo_type}`)}</span>
            <span aria-hidden="true">·</span>
            <span>{t(`area.${d.profile.area}`)}</span>
            {s.primary_cluster && (
              <>
                <span aria-hidden="true">·</span>
                <span>{s.primary_cluster.name}</span>
              </>
            )}
            <span className={`badge ${d.profile.status === 'ACTIVE' ? 'badge-stable' : 'badge-neutral'}`}>
              {t(`status.${d.profile.status}`)}
            </span>
            {d.profile.tenure === 'NEW' && <span className="badge badge-info">{t('tenure.NEW')}</span>}
          </span>
        }
        action={
          <Link href={`/flo/${d.profile.id}/perjanjian`} className="btn btn-secondary">
            {t('agr.open')}
          </Link>
        }
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5" aria-label={t('detail.asOf', { time: nowText })}>
        <div className="glass-card p-4 flex flex-col gap-1.5 min-w-0">
          <span className="text-caption">{t('col.agreement')}</span>
          <AgreementBadge status={s.agreement.status} locale={locale} />
          {s.agreement.valid_through_date && <span className="text-caption tnum">{legalDate(s.agreement.valid_through_date, locale)}</span>}
          {s.agreement.has_pending_version && <span className="text-caption">{t('agreement.pendingVersion')}</span>}
        </div>
        <div className="glass-card p-4 flex flex-col gap-1.5 min-w-0">
          <span className="text-caption">{t('col.need')}</span>
          <NeedSummary band={s.need.band} score={s.need.score} category={s.need.category_code} locale={locale} />
          {s.need.proposed_pending > 0 && <span className="text-caption">{t('need.proposedPending', { n: s.need.proposed_pending })}</span>}
        </div>
        <div className="glass-card p-4 flex flex-col gap-1.5 min-w-0">
          <span className="text-caption">{t('resp.title')}</span>
          <MetricValue value={s.response.value} samples={s.response.eligible} band={s.response.band} locale={locale} />
        </div>
        <div className="glass-card p-4 flex flex-col gap-1.5 min-w-0">
          <span className="text-caption">{t('perf.title')}</span>
          <MetricValue value={s.reporting.value} samples={s.reporting.n} locale={locale} />
        </div>
      </section>
      {d.profile.tenure === 'NEW' && s.reporting.n === 0 && s.response.eligible === 0 && (
        <p className="text-body mb-4" role="note">
          {t('detail.newFlo')}
        </p>
      )}

      <Tabs tabs={tabs} active={active} label={t('detail.tabs')} baseId="flo" />

      <TabPanel baseId="flo" tabId={active}>
        {active === 'profil' && <ProfileTab d={d} locale={locale} canEdit={hasCap(actor, 'flo.edit')} />}
        {active === 'kebutuhan' && (
          <NeedsTab
            d={d}
            locale={locale}
            categories={categories}
            canPropose={hasCap(actor, 'need.propose')}
            canConfirm={hasCap(actor, 'need.confirm')}
          />
        )}
        {active === 'riwayat' && <HistoryTab d={d} locale={locale} />}
        {active === 'kinerja' && <PerformanceTab d={d} locale={locale} />}
        {active === 'perjanjian' && <AgreementsTab d={d} locale={locale} />}
        {active === 'audit' && <AuditTab d={d} locale={locale} />}
      </TabPanel>
    </>
  );
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="glass-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <h2 className="text-title-2">{title}</h2>
      {note && <p className="text-caption">{note}</p>}
      {children}
    </section>
  );
}

function ProfileTab({ d, locale, canEdit }: { d: FloDetail; locale: Locale; canEdit: boolean }) {
  const t = makeT('flo', locale);
  const p = d.profile;
  const yesNo = (b: boolean) => (b ? t('word.yes') : t('word.no'));
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <Section title={t('profile.identity')}>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label={t('col.code')}>
            <span className="mono">{p.code}</span>
          </Field>
          <Field label={t('profile.serviceModel')}>{serviceModelLabel(p.service_model, locale)}</Field>
          <Field label={t('profile.status')}>{t(`status.${p.status}`)}</Field>
          <Field label={t('profile.address')}>{p.address ?? t('profile.none')}</Field>
          <Field label={t('profile.coordinates')}>{p.lat && p.lng ? <span className="tnum">{`${p.lat}, ${p.lng}`}</span> : t('profile.none')}</Field>
          <Field label={t('profile.locationConfidence')}>{t(`loc.${p.location_confidence}`)}</Field>
          <Field label={t('profile.cooking')}>{yesNo(p.cooking_capable)}</Field>
          <Field label={t('profile.storage')}>{p.storage_capabilities.map((x) => t(`storage.${x}`)).join(', ') || t('profile.none')}</Field>
          <Field label={t('profile.halal')}>{yesNo(p.halal_required)}</Field>
          <Field label={t('profile.allergens')}>{p.allergen_exclusions.join(', ') || t('profile.none')}</Field>
          <Field label={t('profile.tenure')}>{t(`tenure.${p.tenure}`)}</Field>
          <Field label={t('profile.revision')}>
            <span className="tnum">{p.revision}</span> · <LocalTime value={p.updated_at} locale={locale} tz={d.timezone} />
          </Field>
        </dl>
      </Section>

      <Section title={t('profile.clusters')}>
        {d.clusters.length === 0 ? (
          <p className="text-body">{t('profile.none')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {d.clusters.map((c) => (
              <li key={c.id} className="badge badge-neutral">
                {c.name} · {t(`area.${c.area}`)}
                {c.is_primary && ` · ${t('profile.primary')}`}
              </li>
            ))}
          </ul>
        )}
        <h3 className="text-title-2 mt-2">{t('profile.prefs')}</h3>
        {d.category_prefs.length === 0 ? (
          <p className="text-body">{t('profile.none')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {d.category_prefs.map((cp) => (
              <li key={cp.category_id} className={`badge ${cp.preference === 'EXCLUDE' ? 'badge-critical' : 'badge-neutral'}`}>
                {categoryLabel(cp.category_code, locale)} · {t(`pref.${cp.preference}`)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('profile.contacts')} note={d.contacts_revealed ? undefined : t('profile.contactsMasked')}>
        <DataTable
          caption={t('profile.contacts')}
          locale={locale}
          rows={d.contacts}
          rowKey={(c) => c.id}
          empty={<EmptyState title={t('profile.noContacts')} locale={locale} />}
          columns={[
            {
              key: 'address',
              header: t('contact.address'),
              priority: 'primary',
              cell: (c) => (
                <span className="mono break-all">
                  {c.address ?? c.address_hint}
                  {c.decrypt_failed && <span className="block text-caption">{t('contact.decryptFailed')}</span>}
                </span>
              ),
            },
            { key: 'channel', header: t('contact.channel'), cell: (c) => c.channel },
            { key: 'role', header: t('contact.role'), cell: (c) => c.role ?? '—' },
            { key: 'verification', header: t('contact.verification'), cell: (c) => c.verification_state },
            {
              key: 'consent',
              header: t('contact.consent'),
              cell: (c) => (
                <span>
                  {c.consent_state}
                  {c.opted_out_at && (
                    <span className="block text-caption">
                      {t('contact.optedOut', { time: formatWib(c.opted_out_at, { locale, tz: d.timezone }) })}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Section>

      {canEdit && (
        <FloProfileForm
          floId={p.id}
          revision={p.revision}
          canEdit={canEdit}
          initial={{
            name: p.name,
            flo_type: p.flo_type,
            service_model: p.service_model,
            status: p.status,
            address: p.address,
            area: p.area,
            lat: p.lat,
            lng: p.lng,
            location_confidence: p.location_confidence,
            cooking_capable: p.cooking_capable,
            halal_required: p.halal_required,
          }}
        />
      )}
    </div>
  );
}

function NeedsTab({
  d,
  locale,
  categories,
  canPropose,
  canConfirm,
}: {
  d: FloDetail;
  locale: Locale;
  categories: CategoryRef[];
  canPropose: boolean;
  canConfirm: boolean;
}) {
  const t = makeT('flo', locale);
  const tz = d.timezone;
  const dows = (xs: number[]) => xs.map((x) => t(`dow.${x}`)).join(', ');
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <Section title={t('sched.title')} note={t('sched.note')}>
        <DataTable
          caption={t('sched.title')}
          locale={locale}
          rows={d.schedules}
          rowKey={(r) => r.id}
          empty={<EmptyState title={t('sched.empty')} locale={locale} />}
          columns={[
            {
              key: 'eff',
              header: t('sched.effective'),
              priority: 'primary',
              cell: (r) => (
                <span className="flex flex-col">
                  <span>
                    {r.effective_to_excl
                      ? t('sched.range', { from: legalDate(r.effective_from, locale, false), to: legalDate(r.effective_to_excl, locale, false) })
                      : t('sched.from', { date: legalDate(r.effective_from, locale, false) })}{' '}
                    (WIB)
                  </span>
                  {r.current && <span className="badge badge-stable self-start">{t('sched.current')}</span>}
                </span>
              ),
            },
            { key: 'days', header: t('sched.days'), cell: (r) => dows(r.service_dows) },
            { key: 'basis', header: t('sched.basis'), cell: (r) => t(`basis.${r.count_basis}`) },
            { key: 'people', header: t('sched.people'), align: 'end', cell: (r) => <span className="tnum">{r.people_per_event}</span> },
            { key: 'declared', header: t('sched.declared'), align: 'end', cell: (r) => <span className="tnum">{r.declared_count ?? '—'}</span> },
            {
              key: 'verified',
              header: t('sched.verified'),
              cell: (r) =>
                r.verified_count === null ? (
                  <span className="badge badge-neutral">{t('sched.notVerified')}</span>
                ) : (
                  <span className="flex flex-col">
                    <span className="tnum font-semibold">{r.verified_count}</span>
                    <span className="text-caption">
                      {t('sched.verifiedBy', {
                        name: r.verified_by_name ?? '—',
                        time: r.verified_at ? formatWib(r.verified_at, { locale, tz, style: 'date' }) : '—',
                      })}
                    </span>
                  </span>
                ),
            },
          ]}
        />
      </Section>

      <Section title={t('demand.title')}>
        <DataTable
          caption={t('demand.title')}
          locale={locale}
          rows={d.demands}
          rowKey={(r) => r.id}
          empty={<EmptyState title={t('demand.empty')} locale={locale} />}
          columns={[
            { key: 'cat', header: t('demand.category'), priority: 'primary', cell: (r) => categoryLabel(r.category_code, locale) },
            {
              key: 'qty',
              header: t('demand.quantity'),
              cell: (r) => (
                <span>
                  <UnitQty value={r.quantity} unit={r.unit} locale={locale} /> {t(`demand.${r.basis}`)}
                </span>
              ),
            },
            {
              key: 'valid',
              header: t('demand.valid'),
              cell: (r) =>
                r.valid_to_excl
                  ? t('sched.range', { from: legalDate(r.valid_from, locale, false), to: legalDate(r.valid_to_excl, locale, false) })
                  : t('sched.from', { date: legalDate(r.valid_from, locale) }),
            },
            { key: 'conf', header: t('demand.confidence'), cell: (r) => t(`conf.${r.confidence}`) },
            { key: 'status', header: t('demand.status'), cell: (r) => t(`demand.${r.status}`) },
          ]}
        />
      </Section>

      <Section title={t('cap.title')}>
        <DataTable
          caption={t('cap.title')}
          locale={locale}
          rows={d.capacities}
          rowKey={(r) => r.id}
          empty={<EmptyState title={t('cap.empty')} locale={locale} />}
          columns={[
            { key: 'cat', header: t('demand.category'), priority: 'primary', cell: (r) => categoryLabel(r.category_code, locale) },
            {
              key: 'pe',
              header: t('cap.perEvent'),
              cell: (r) => (r.per_event_capacity === null ? t('cap.unknown') : <UnitQty value={r.per_event_capacity} unit={r.unit} locale={locale} />),
            },
            {
              key: 'dist',
              header: t('cap.distribution'),
              cell: (r) =>
                r.distribution_capacity === null ? t('cap.unknown') : <UnitQty value={r.distribution_capacity} unit={r.unit} locale={locale} />,
            },
            {
              key: 'conf',
              header: t('cap.confirmed'),
              cell: (r) =>
                r.confirmed_at ? (
                  <span>
                    <LocalTime value={r.confirmed_at} locale={locale} tz={tz} style="date" />
                    {r.confirmed_by_name && <span className="block text-caption">{r.confirmed_by_name}</span>}
                  </span>
                ) : (
                  <span className="badge badge-monitor">{t('cap.unknown')}</span>
                ),
            },
          ]}
        />
      </Section>

      <Section title={t('avail.title')}>
        <DataTable
          caption={t('avail.title')}
          locale={locale}
          rows={d.availability}
          rowKey={(r) => r.id}
          empty={<EmptyState title={t('avail.empty')} locale={locale} />}
          columns={[
            { key: 'kind', header: t('avail.kind'), priority: 'primary', cell: (r) => t(`avail.${r.kind}`) },
            {
              key: 'when',
              header: t('avail.when'),
              cell: (r) =>
                r.dow !== null ? (
                  t('avail.weekly', { day: t(`dow.${r.dow}`), from: r.start_local ?? '', to: r.end_local ?? '' })
                ) : (
                  <span>
                    <LocalTime value={r.starts_at} locale={locale} tz={tz} /> – <LocalTime value={r.ends_at} locale={locale} tz={tz} />
                  </span>
                ),
            },
          ]}
        />
      </Section>

      <Section title={t('needs.title')} note={t('needs.note')}>
        <DataTable
          caption={t('needs.title')}
          locale={locale}
          rows={d.needs}
          rowKey={(r) => r.id}
          empty={<EmptyState title={t('needs.empty')} locale={locale} />}
          columns={[
            {
              key: 'cat',
              header: t('needs.category'),
              priority: 'primary',
              cell: (r) => (
                <span className="flex flex-col">
                  <span>{categoryLabel(r.category_code, locale)}</span>
                  <span className="tnum font-semibold">{fmtNumeric(r.score, locale)}</span>
                </span>
              ),
            },
            {
              key: 'status',
              header: t('needs.status'),
              cell: (r) => (
                <span className="flex flex-col gap-1 items-start">
                  <span className={`badge ${r.freshness === 'FRESH' ? 'badge-stable' : r.freshness === 'PENDING' ? 'badge-accent' : 'badge-neutral'}`}>
                    {t(`freshness.${r.freshness}`)}
                  </span>
                  {r.freshness === 'STALE' && (
                    <StaleBadge asOf={r.assessed_at} stale always locale={locale} tz={tz} />
                  )}
                  {r.confirmed_by_name && <span className="text-caption">{t('needs.confirmedBy', { name: r.confirmed_by_name })}</span>}
                  {r.freshness === 'PENDING' && <NeedConfirmButton floId={d.profile.id} needId={r.id} canConfirm={canConfirm} />}
                </span>
              ),
            },
            {
              key: 'req',
              header: t('needs.requested'),
              cell: (r) => (r.requested_qty ? <UnitQty value={r.requested_qty} unit={r.unit ?? t('needs.unknownUnit')} locale={locale} /> : '—'),
            },
            {
              key: 'intended',
              header: t('needs.intended'),
              hideOnMobile: true,
              cell: (r) => legalDate(r.intended_distribution_date, locale),
            },
            {
              key: 'assessed',
              header: t('needs.assessedAt'),
              cell: (r) => (
                <span className="flex flex-col">
                  <LocalTime value={r.assessed_at} locale={locale} tz={tz} />
                  {r.assessor_name && <span className="text-caption">{r.assessor_name}</span>}
                </span>
              ),
            },
            { key: 'expires', header: t('needs.expiresAt'), cell: (r) => <LocalTime value={r.expires_at} locale={locale} tz={tz} /> },
            { key: 'basis', header: t('needForm.basis'), hideOnMobile: true, cell: (r) => r.basis ?? '—' },
          ]}
        />
        {canPropose && (
          <NeedProposalForm
            floId={d.profile.id}
            canPropose={canPropose}
            canConfirm={canConfirm}
            categories={categories.map((c) => ({
              id: c.id,
              code: c.code,
              label: `${c.code} — ${locale === 'en' ? c.name_en : c.name_id}`,
              comparable_unit: c.comparable_unit,
            }))}
          />
        )}
      </Section>
    </div>
  );
}

function HistoryTab({ d, locale }: { d: FloDetail; locale: Locale }) {
  const t = makeT('flo', locale);
  const tz = d.timezone;
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <Section title={t('hist.title')} note={t('hist.note', { time: formatWib(d.now, { locale, tz }) })}>
        <DataTable
          caption={t('hist.title')}
          locale={locale}
          rows={d.history}
          rowKey={(r) => `${r.category_id}:${r.unit ?? '-'}`}
          empty={<EmptyState title={t('hist.empty')} locale={locale} />}
          columns={[
            {
              key: 'cat',
              header: t('hist.category'),
              priority: 'primary',
              cell: (r) => (
                <span className="flex flex-col">
                  <span>
                    {r.category_code} — {locale === 'en' ? r.category_name_en : r.category_name_id}
                  </span>
                  {r.unit && !r.comparable && (
                    <span className="text-caption">{t('hist.notComparable', { unit: r.comparable_unit })}</span>
                  )}
                </span>
              ),
            },
            {
              key: 'd7',
              header: t('hist.d7'),
              align: 'end',
              cell: (r) => (r.unit ? <UnitQty value={r.qty_7d} unit={r.unit} locale={locale} /> : <span className="text-caption">{t('hist.none')}</span>),
            },
            {
              key: 'd30',
              header: t('hist.d30'),
              align: 'end',
              cell: (r) => (r.unit ? <UnitQty value={r.qty_30d} unit={r.unit} locale={locale} /> : '—'),
            },
            {
              key: 'rej',
              header: t('hist.rejected30'),
              align: 'end',
              hideOnMobile: true,
              cell: (r) => (r.unit ? <UnitQty value={r.rejected_30d} unit={r.unit} locale={locale} /> : '—'),
            },
            {
              key: 'direct',
              header: t('hist.direct30'),
              align: 'end',
              hideOnMobile: true,
              cell: (r) => (r.unit ? <UnitQty value={r.direct_30d} unit={r.unit} locale={locale} /> : '—'),
            },
            {
              key: 'wh',
              header: t('hist.warehouse30'),
              align: 'end',
              hideOnMobile: true,
              cell: (r) => (r.unit ? <UnitQty value={r.warehouse_30d} unit={r.unit} locale={locale} /> : '—'),
            },
            { key: 'n', header: t('hist.receipts30'), align: 'end', cell: (r) => <span className="tnum">{r.receipts_30d}</span> },
            {
              key: 'last',
              header: t('hist.last'),
              cell: (r) => (r.last_received_at ? <LocalTime value={r.last_received_at} locale={locale} tz={tz} relativeTo={d.now} /> : '—'),
            },
          ]}
        />
      </Section>

      <Section title={t('hist.recent')}>
        <DataTable
          caption={t('hist.recent')}
          locale={locale}
          rows={d.recent_receipts}
          rowKey={(r) => r.receipt_line_id}
          empty={<EmptyState title={t('hist.recentEmpty')} locale={locale} />}
          columns={[
            {
              key: 'when',
              header: t('hist.receivedAt'),
              priority: 'primary',
              cell: (r) => <LocalTime value={r.received_at} locale={locale} tz={tz} />,
            },
            { key: 'delivery', header: t('hist.delivery'), cell: (r) => <span className="mono">{r.delivery_code}</span> },
            { key: 'route', header: t('hist.route'), cell: (r) => t(`hist.${r.route}`) },
            { key: 'cat', header: t('hist.category'), cell: (r) => categoryLabel(r.category_code, locale) },
            { key: 'acc', header: t('hist.accepted'), align: 'end', cell: (r) => <UnitQty value={r.accepted_qty} unit={r.unit} locale={locale} /> },
            {
              key: 'rej',
              header: t('hist.rejected'),
              align: 'end',
              cell: (r) =>
                r.rejected_qty === '0' || r.rejected_qty === '0.000' ? (
                  '—'
                ) : (
                  <span>
                    <UnitQty value={r.rejected_qty} unit={r.unit} locale={locale} />
                    {r.discrepancy_reason && <span className="block text-caption">{r.discrepancy_reason}</span>}
                  </span>
                ),
            },
          ]}
        />
      </Section>
    </div>
  );
}

function PerformanceTab({ d, locale }: { d: FloDetail; locale: Locale }) {
  const t = makeT('flo', locale);
  const tz = d.timezone;
  const period = (from: string | null, to: string | null) =>
    from && to
      ? t('perf.periodRange', {
          from: formatWib(from, { locale, tz, style: 'date' }),
          to: formatWib(to, { locale, tz, style: 'date' }),
        }) + ' (WIB)'
      : t('perf.noPeriod');
  const r = d.responsiveness;
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <Section title={t('resp.title')} note={t('resp.formula')}>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label={t('resp.value')}>
            <MetricValue value={r.value} samples={r.eligible} band={d.summary.response.band} locale={locale} />
          </Field>
          <Field label={t('resp.eligible')}>
            <span className="tnum">{r.eligible}</span>
          </Field>
          <Field label={t('resp.timely')}>
            <span className="tnum">{r.timely}</span>
          </Field>
          <Field label={t('resp.excluded')}>
            <span className="tnum">{r.excluded}</span>
          </Field>
        </dl>
        <p className="text-caption">
          {t('perf.period')}: {period(r.period_from, r.period_to)}
        </p>
        {r.eligible === 0 && <p className="text-body">{t('metric.insufficientLong')}</p>}
      </Section>

      <Section title={t('perf.title')} note={t('perf.formula')}>
        <p className="text-body">
          {t('perf.composite')}: <MetricValue value={d.reporting.value} samples={d.reporting.n} locale={locale} />
        </p>
        <DataTable
          caption={t('perf.title')}
          locale={locale}
          rows={d.reporting.by_type}
          rowKey={(x) => x.type}
          columns={[
            {
              key: 'type',
              header: t('perf.type'),
              priority: 'primary',
              cell: (x) => (
                <span>
                  {t(`perf.${x.type}`)} <span className="text-caption">× {fmt2(x.weight, locale)}</span>
                </span>
              ),
            },
            { key: 'value', header: t('perf.value'), cell: (x) => <MetricValue value={x.value} samples={x.n} locale={locale} /> },
            { key: 'on', header: t('perf.onTime'), align: 'end', cell: (x) => <span className="tnum">{x.on_time}</span> },
            { key: 'late', header: t('perf.late'), align: 'end', cell: (x) => <span className="tnum">{x.late}</span> },
            { key: 'miss', header: t('perf.missing'), align: 'end', cell: (x) => <span className="tnum">{x.missing}</span> },
            { key: 'pend', header: t('perf.pending'), align: 'end', hideOnMobile: true, cell: (x) => <span className="tnum">{x.pending_review}</span> },
            { key: 'nd', header: t('perf.notDue'), align: 'end', hideOnMobile: true, cell: (x) => <span className="tnum">{x.open_not_due}</span> },
            { key: 'exc', header: t('perf.excused'), align: 'end', hideOnMobile: true, cell: (x) => <span className="tnum">{x.excused}</span> },
            { key: 'period', header: t('perf.period'), cell: (x) => period(x.period_from, x.period_to) },
          ]}
        />
        <p className="text-caption">{t('perf.derived')}</p>
      </Section>
    </div>
  );
}

function AgreementsTab({ d, locale }: { d: FloDetail; locale: Locale }) {
  const t = makeT('flo', locale);
  const current = d.agreements.find((a) => a.status === 'ACTIVE');
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <Section title={t('agr.title')} note={t('agr.versions', { n: d.agreements.length })}>
        {current ? (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={t('agr.current')}>
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>{t('word.version', { v: current.version })}</span>
                <VersionStatusBadge status={current.status} locale={locale} />
                {current.expiring_soon && <span className="badge badge-monitor">{t('rev.expiringBadge')}</span>}
              </span>
            </Field>
            <Field label={t('rev.legal')}>
              {t('rev.fromThrough', { from: legalDate(current.valid_from_date, locale, false), through: legalDate(current.valid_through_date, locale) })}
            </Field>
            <Field label={t('rev.exclusiveEnd')}>
              <LocalTime value={current.valid_until_exclusive} locale={locale} tz={d.timezone} />
            </Field>
          </dl>
        ) : (
          <p className="text-body">{t('agr.none', { time: formatWib(d.now, { locale, tz: d.timezone }) })}</p>
        )}
        <DataTable
          caption={t('rev.versions')}
          locale={locale}
          rows={d.agreements}
          rowKey={(a) => a.id}
          empty={<EmptyState title={t('agreement.NONE')} locale={locale} />}
          columns={[
            { key: 'v', header: t('rev.version'), priority: 'primary', cell: (a) => t('word.version', { v: a.version }) },
            { key: 's', header: t('rev.state'), cell: (a) => <VersionStatusBadge status={a.status} locale={locale} /> },
            {
              key: 'i',
              header: t('rev.interval'),
              cell: (a) => t('rev.fromThrough', { from: legalDate(a.valid_from_date, locale, false), through: legalDate(a.valid_through_date, locale) }),
            },
          ]}
        />
        <div>
          <Link href={`/flo/${d.profile.id}/perjanjian`} className="btn btn-primary">
            {t('agr.open')}
          </Link>
        </div>
      </Section>
    </div>
  );
}

function AuditTab({ d, locale }: { d: FloDetail; locale: Locale }) {
  const t = makeT('flo', locale);
  if (d.audit === null) {
    return <EmptyState title={t('audit.noAccess')} locale={locale} />;
  }
  return (
    <Section title={t('audit.title')}>
      <DataTable
        caption={t('audit.title')}
        locale={locale}
        rows={d.audit}
        rowKey={(a) => a.id}
        empty={<EmptyState title={t('audit.empty')} locale={locale} />}
        columns={[
          { key: 'when', header: t('audit.when'), priority: 'primary', cell: (a) => <LocalTime value={a.occurred_at} locale={locale} tz={d.timezone} seconds /> },
          {
            key: 'action',
            header: t('audit.action'),
            cell: (a) => (
              <span className="flex flex-col">
                <span>{t(`auditAction.${a.action}`)}</span>
                <span className="text-caption mono">{a.action}</span>
              </span>
            ),
          },
          { key: 'actor', header: t('audit.actor'), cell: (a) => a.actor_name ?? `${t('audit.system')} (${a.actor_kind})` },
          {
            key: 'subject',
            header: t('audit.subject'),
            cell: (a) => (
              <span>
                {t(`subject.${a.subject_type}`)}
                {a.subject_revision !== null && <span className="text-caption"> · {t('audit.revision', { rev: a.subject_revision })}</span>}
              </span>
            ),
          },
          { key: 'reason', header: t('audit.reason'), cell: (a) => a.reason ?? '—' },
        ]}
      />
    </Section>
  );
}
