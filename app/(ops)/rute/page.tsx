import Link from 'next/link';
import { CalendarClock, MapPin, Package, UserRound } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { PublishRouteForm, RouteActions } from '@/components/volunteers/VolunteerActions';
import styles from '@/components/volunteers/volunteer.module.css';
import { listEligibleDeliveries, listVolunteerRoutes, listVolunteers, type VolunteerRoute } from '@/src/application/volunteers/queries';
import { volunteerPage } from '@/src/application/volunteers/page-context';
import { makeT } from '@/src/i18n';
import { formatWib } from '@/src/lib/tz';

function RouteCard({ route, actorId, manage, claim, progress, volunteers, locale }: {
  route: VolunteerRoute;
  actorId: string;
  manage: boolean;
  claim: boolean;
  progress: boolean;
  volunteers: Awaited<ReturnType<typeof listVolunteers>>;
  locale: 'id' | 'en';
}) {
  const t = makeT('volunteer', locale);
  const terminal = ['COMPLETED','HANDOFF_RECORDED','FAILED','CANCELLED'].includes(route.display_state);
  return <article className={styles.routeCard}>
    <div className={styles.routeTop}><div><p className={styles.routeCode}>{route.delivery_code}</p><h3 className={styles.routeTitle}>{route.source.name} → {route.destination.name}</h3></div><span className={styles.state} data-terminal={terminal}>{t(`step.${route.display_state}`)}</span></div>
    <div className={styles.routeLine}><MapPin size={17} aria-hidden="true"/><div><strong>{t('pickup')}</strong>{route.source.address ?? route.source.name}</div></div>
    <div className={styles.routeLine}><Package size={17} aria-hidden="true"/><div><strong>{t('contents')}</strong>{route.lines.map((line) => `${line.description} · ${line.quantity} ${line.unit}`).join(', ')}</div></div>
    <div className={styles.routeMeta}>
      <span className={styles.pill}>{route.distance_km == null ? t('distanceUnknown') : t('distance', { distance: route.distance_km })}</span>
      {route.planned_pickup_at && <span className={styles.pill}><CalendarClock size={12} aria-hidden="true"/> {formatWib(route.planned_pickup_at, { locale })}</span>}
      <span className={styles.pill}><UserRound size={12} aria-hidden="true"/> {route.volunteer_name ?? t('unassigned')}</span>
    </div>
    <Link className="direct-link" href={`/rute/${route.id}`}>{t('details')} →</Link>
    <RouteActions route={route} currentUserId={actorId} caps={{ manage, claim, progress }} volunteers={volunteers}/>
  </article>;
}

export default async function VolunteerRoutesPage() {
  const { actor, locale, can, tx } = await volunteerPage('routes');
  const t = makeT('volunteer', locale);
  const manage = can('route.manage');
  const [routes, volunteers, eligible] = await tx(async (c) => Promise.all([
    listVolunteerRoutes(c, { userId: actor.userId, canManage: manage }),
    manage ? listVolunteers(c) : Promise.resolve([]),
    manage ? listEligibleDeliveries(c) : Promise.resolve([]),
  ]));
  const available = routes.filter((route) => route.state === 'OPEN');
  const mine = routes.filter((route) => route.volunteer_user_id === actor.userId && !['HANDOFF_RECORDED','FAILED','CANCELLED'].includes(route.state));
  return <>
    <Header title={t('title')} subtitle={t('subtitle')}/>
    <div className={styles.page}>
      {manage && <section className={styles.section} aria-labelledby="publish-route"><div className={styles.sectionHeader}><div><h2 id="publish-route">{t('publish')}</h2><p>{t('publishHint')}</p></div></div><PublishRouteForm deliveries={eligible} volunteers={volunteers}/></section>}
      {can('route.claim') && <section className={styles.section} aria-labelledby="available-routes"><div className={styles.sectionHeader}><div><h2 id="available-routes">{t('browse')}</h2><p>{t('subtitle')}</p></div></div>{available.length ? <div className={styles.routeGrid}>{available.map((route) => <RouteCard key={route.id} route={route} actorId={actor.userId} manage={manage} claim={can('route.claim')} progress={can('route.progress')} volunteers={volunteers} locale={locale}/>)}</div> : <p className="text-caption">{t('noAvailable')}</p>}</section>}
      {can('route.progress') && <section className={styles.section} aria-labelledby="my-routes"><div className={styles.sectionHeader}><div><h2 id="my-routes">{t('mine')}</h2></div></div>{mine.length ? <div className={styles.routeGrid}>{mine.map((route) => <RouteCard key={route.id} route={route} actorId={actor.userId} manage={manage} claim={can('route.claim')} progress={can('route.progress')} volunteers={volunteers} locale={locale}/>)}</div> : <p className="text-caption">{t('noMine')}</p>}</section>}
      {manage && <section className={styles.section} aria-labelledby="dispatch-board"><div className={styles.sectionHeader}><div><h2 id="dispatch-board">{t('dispatch')}</h2></div></div>{routes.length ? <div className={styles.routeGrid}>{routes.map((route) => <RouteCard key={route.id} route={route} actorId={actor.userId} manage claim={false} progress={false} volunteers={volunteers} locale={locale}/>)}</div> : <p className="text-caption">{t('noDispatch')}</p>}</section>}
    </div>
  </>;
}
