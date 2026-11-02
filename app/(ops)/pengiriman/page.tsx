import { Header } from '@/components/layout/Header';
import { Pagination } from '@/components/operations/Pagination';
import { RecordList } from '@/components/operations/RecordList';
import { RecordHeading, RecordFacts, RecordFact, StatusBadge } from '@/components/operations/RecordParts';
import { Section } from '../ringkasan/_parts';
import { directPage } from '@/src/application/direct/page-context';
import { listDeliveries } from '@/src/application/direct/queries';
import { readPage } from '@/src/ui/pagination';
import { codeLabel } from '@/src/ui/presentation';

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const offset = await readPage(searchParams);
  const { t, tx, locale } = await directPage();
  const rows = await tx(c => listDeliveries(c, null, offset));
  return <><Header title={t('deliveries')} /><div className="direct-page"><p className="text-body">{t('actual')}</p>
    <Section id="deliveries" title={locale === 'id' ? 'Daftar pengiriman' : 'Delivery list'}><RecordList records={rows.map(d => ({ id: d.id, search: `${d.code} ${d.flo_name}`, status: codeLabel(d.state, locale), content: <>
      <RecordHeading href={`/pengiriman/${d.id}`} title={d.flo_name} code={d.code} />
      <RecordFacts><RecordFact label={locale === 'id' ? 'Jalur pengiriman' : 'Delivery route'}>{codeLabel(d.route, locale)}</RecordFact></RecordFacts>
      <StatusBadge code={d.state} locale={locale} />
    </> }))} /></Section><Pagination offset={offset} hasNext={rows.length === 50} /></div></>;
}
