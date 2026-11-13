import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { RouteActions } from '@/components/volunteers/VolunteerActions';
import styles from '@/components/volunteers/volunteer.module.css';
import { listVolunteerRoutes, listVolunteers } from '@/src/application/volunteers/queries';
import { volunteerPage } from '@/src/application/volunteers/page-context';
import { makeT } from '@/src/i18n';
import { isUuid } from '@/src/lib/uuidv5';
import { formatWib } from '@/src/lib/tz';

const STEPS = ['CLAIMED','EN_ROUTE_TO_PICKUP','AT_PICKUP','PICKED_UP','EN_ROUTE_TO_DROPOFF','AT_DROPOFF','HANDOFF_RECORDED'];

export default async function VolunteerRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { actor, locale, can, tx } = await volunteerPage('routes');
  const manage = can('route.manage');
  const [route, volunteers] = await tx(async (c) => Promise.all([
    listVolunteerRoutes(c, { userId: actor.userId, canManage: manage }, id).then((routes) => routes[0]),
    manage ? listVolunteers(c) : Promise.resolve([]),
  ]));
  if (!route) notFound();
  const t = makeT('volunteer', locale);
  const current = route.state === 'OPEN' ? -1 : STEPS.indexOf(route.state);
  const mapsUrl = route.destination.lat == null || route.destination.lng == null ? null : `https://www.google.com/maps/dir/?api=1&destination=${route.destination.lat},${route.destination.lng}`;
  return <>
    <Header title={route.delivery_code} eyebrow={t('title')} subtitle={t(`step.${route.display_state}`)}/>
    <div className={styles.page}>
      <section className={styles.detailHero}><p>{route.distance_km == null ? t('distanceUnknown') : t('distance', { distance: route.distance_km })}</p><h1>{route.source.name} → {route.destination.name}</h1><p>{route.lines.map((line) => `${line.description} · ${line.quantity} ${line.unit}`).join(', ')}</p></section>
      <div className={styles.timeline} aria-label={t('details')}>{STEPS.map((step,index) => <span key={step} className={styles.timelineStep} data-done={index<=current}>{t(`step.${step}`)}</span>)}</div>
      <div className={styles.detailGrid}>
        <section className={styles.locationCard}><h2>{t('pickup')}</h2><strong>{route.source.name}</strong><p>{route.source.address ?? '—'}</p>{route.planned_pickup_at && <p>{formatWib(route.planned_pickup_at, { locale })}</p>}</section>
        <section className={styles.locationCard}><h2>{t('dropoff')}</h2><strong>{route.destination.name}</strong><p>{route.destination.address ?? '—'}</p>{route.planned_arrival_at && <p>{formatWib(route.planned_arrival_at, { locale })}</p>}{mapsUrl && <a className={styles.navLink} href={mapsUrl} target="_blank" rel="noreferrer">{t('navigation')} ↗</a>}</section>
      </div>
      <p className={styles.notice}>{t('safetyBoundary')}</p>
      <section className={styles.section}><RouteActions route={route} currentUserId={actor.userId} caps={{ manage, claim: can('route.claim'), progress: can('route.progress') }} volunteers={volunteers}/></section>
    </div>
  </>;
}
