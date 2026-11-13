import { Header } from '@/components/layout/Header';
import { VolunteerProfileForm } from '@/components/volunteers/VolunteerActions';
import styles from '@/components/volunteers/volunteer.module.css';
import { listVolunteers } from '@/src/application/volunteers/queries';
import { volunteerPage } from '@/src/application/volunteers/page-context';
import { makeT } from '@/src/i18n';

export default async function VolunteersPage() {
  const { locale, can, tx } = await volunteerPage('volunteers');
  const t = makeT('volunteer', locale);
  const volunteers = await tx(listVolunteers);
  const manage = can('volunteer.manage');
  return <>
    <Header title={t('volunteersTitle')} subtitle={t('volunteersSubtitle')}/>
    <div className={styles.page}><section className={styles.section}>
      <div className={styles.volunteerGrid}>{volunteers.map((volunteer) => <article className={styles.profileCard} key={volunteer.user_id}>
        <div className={styles.profileHeader}><div><p className={styles.routeCode}>{volunteer.status}</p><h2 className={styles.profileName}>{volunteer.display_name}</h2></div><span className={styles.state}>{volunteer.vehicle_type}</span></div>
        <dl className={styles.profileFacts}>
          <div className={styles.fact}><dt>{t('capacity')}</dt><dd>{volunteer.max_load_kg} kg</dd></div>
          <div className={styles.fact}><dt>{t('homeArea')}</dt><dd>{volunteer.home_area}</dd></div>
          <div className={styles.fact}><dt>{t('activeRoutes')}</dt><dd>{volunteer.active_routes}</dd></div>
          <div className={styles.fact}><dt>{t('completedRoutes')}</dt><dd>{volunteer.completed_routes}</dd></div>
        </dl>
        <p className="text-caption">{volunteer.available_dows.join(', ')} · {volunteer.available_start.slice(0,5)}–{volunteer.available_end.slice(0,5)} · {t('refrigerated')}: {volunteer.refrigerated?t('yes'):t('no')}</p>
        {manage && <details><summary>{t('profile')}</summary><VolunteerProfileForm volunteer={volunteer}/></details>}
      </article>)}{!volunteers.length && <p className="text-caption">{t('noAvailable')}</p>}</div>
    </section></div>
  </>;
}
