import { notFound, redirect } from 'next/navigation';
import { Network } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { GuideExplorer } from '@/components/prototype-guide/GuideExplorer';
import { DownloadGuide } from '@/components/prototype-guide/DownloadGuide';
import { guideCopy, guideMaps } from '@/components/prototype-guide/content';
import styles from '@/components/prototype-guide/guide.module.css';
import { getEnv } from '@/src/config/env';
import { prototypeGuideEnabled } from '@/src/config/prototype-guide';
import { getLocale } from '@/src/i18n/server';
import { getServerActor } from '@/src/security/actor';
import { navForCapabilities } from '@/src/ui/nav';

export async function generateMetadata() {
  return { title: `${guideCopy(await getLocale()).title} · Lumbung`, robots: { index: false, follow: false } };
}

export default async function PrototypeGuidePage({ searchParams }: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const actor = await getServerActor();
  if (!actor) redirect('/masuk');
  if (!prototypeGuideEnabled({ appMode: getEnv().APP_MODE, tenantMode: actor.tenantMode, flag: process.env.PROTOTYPE_GUIDE_ENABLED })) notFound();

  const locale = await getLocale();
  const copy = guideCopy(locale);
  const maps = guideMaps(locale);
  const params = await searchParams;
  const current = maps.find(map => map.id === params.view) ?? maps[0];
  const allowedPaths = navForCapabilities(actor.capabilities).map(item => item.href);

  return <div className={styles.page} data-testid="prototype-guide">
    <Header title={copy.title} subtitle={copy.subtitle} eyebrow={copy.prototype}
      action={<DownloadGuide maps={maps} locale={locale} />} />
    <div className={styles.notice} role="note"><Network size={20} aria-hidden="true" /><div><strong>{copy.prototype}</strong><p>{copy.note}</p></div></div>
    <Tabs tabs={maps.map(map => ({ id: map.id, label: map.label }))} active={current.id} label={copy.diagrams} baseId="visual-guide" param="view" />
    <TabPanel baseId="visual-guide" tabId={current.id}>
      <GuideExplorer key={current.id} map={current} locale={locale} allowedPaths={allowedPaths} />
    </TabPanel>
  </div>;
}
