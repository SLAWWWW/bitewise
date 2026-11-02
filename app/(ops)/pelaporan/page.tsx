import { Header } from '@/components/layout/Header';
import { Pagination } from '@/components/operations/Pagination';
import { RecordList } from '@/components/operations/RecordList';
import { RecordHeading, RecordFacts, RecordFact, StatusBadge } from '@/components/operations/RecordParts';
import { Section } from '../ringkasan/_parts';
import { directPage } from '@/src/application/direct/page-context';
import { obligations } from '@/src/application/operations/queries';
import { makeT } from '@/src/i18n';
import { formatWib } from '@/src/lib/tz';
import { readPage } from '@/src/ui/pagination';
import { codeLabel } from '@/src/ui/presentation';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const offset = await readPage(searchParams);
  const { tx, locale } = await directPage();
  const t = makeT('ops', locale);
  const rows = await tx(c => obligations(c, null, offset));
  return <><Header title={t('reporting')} /><div className="direct-page"><p className="text-body">{locale === 'id' ? 'Buka laporan untuk mengirim atau meninjau bukti. Periksa jenis bukti dan batas waktunya.' : 'Open a report to submit or review evidence. Check the evidence type and its deadline.'}</p>
    <Section id="reports" title={locale === 'id' ? 'Daftar laporan' : 'Report list'}><RecordList records={rows.map(o => ({ id: o.id, search: `${o.flo_name} ${codeLabel(o.type, locale)}`, status: codeLabel(o.state, locale), content: <>
      <RecordHeading href={`/pelaporan/${o.id}`} title={o.flo_name} code={codeLabel(o.type, locale)} />
      <RecordFacts><RecordFact label={t('due')}>{formatWib(o.due_at, { locale })}</RecordFact>{o.resolved_timeliness && <RecordFact label={locale === 'id' ? 'Ketepatan waktu' : 'Timeliness'}>{codeLabel(o.resolved_timeliness, locale)}</RecordFact>}</RecordFacts>
      <StatusBadge code={o.state} locale={locale} />
    </> }))} /></Section><Pagination offset={offset} hasNext={rows.length === 50} /></div></>;
}
