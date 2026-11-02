import { Header } from '@/components/layout/Header';
import { Pagination } from '@/components/operations/Pagination';
import { RecordList } from '@/components/operations/RecordList';
import { RecordHeading, RecordFacts, RecordFact, StatusBadge } from '@/components/operations/RecordParts';
import { CommandForm } from '@/components/operations/CommandForm';
import { Section } from '../ringkasan/_parts';
import { directPage } from '@/src/application/direct/page-context';
import { conversations, references } from '@/src/application/operations/queries';
import { makeT } from '@/src/i18n';
import { readPage } from '@/src/ui/pagination';
import { codeLabel } from '@/src/ui/presentation';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const offset = await readPage(searchParams);
  const { tx, locale, can } = await directPage();
  const t = makeT('ops', locale);
  const rows = await tx(c => conversations(c, null, offset));
  const refs = can('message.send') ? await tx(references) : null;
  return <><Header title={t('inbox')} /><div className="direct-page"><p className="text-body">{locale === 'id' ? 'Buka percakapan untuk membaca pesan atau membantu FLO. Pesan pada demo ini disimulasikan.' : 'Open a conversation to read messages or help a FLO. Messages in this demo are simulated.'}</p>
    <Section id="inbox" title={locale === 'id' ? 'Percakapan FLO' : 'FLO conversations'}><RecordList records={rows.map(c => ({ id: c.id, search: c.flo_name, status: codeLabel(c.agent_paused ? 'HUMAN' : c.state, locale), content: <>
      <RecordHeading href={`/pesan/${c.id}`} title={c.flo_name} />
      <RecordFacts><RecordFact label={locale === 'id' ? 'Penanganan' : 'Handled by'}>{c.agent_paused ? (locale === 'id' ? 'Operator manusia' : 'Human operator') : (locale === 'id' ? 'Asisten simulasi' : 'Simulated assistant')}</RecordFact></RecordFacts>
      <StatusBadge code={c.agent_paused ? 'HUMAN' : c.state} locale={locale} />
    </> }))} /></Section>
    {refs && <Section id="simulate" title={t('simulate')}><details><summary>{locale === 'id' ? 'Buat pesan masuk untuk mencoba alur' : 'Create an incoming message to try the workflow'}</summary><CommandForm url="/api/demo/simulate-flo" label="simulate" base={{ event_id: crypto.randomUUID() }} fields={[{ name: 'contact_id', label: 'contact', type: 'select', options: refs.contacts.map(c => ({ value: c.id, label: c.name })) }, { name: 'text', label: 'text', type: 'textarea' }, { name: 'offer_code', label: 'offerCode', optional: true }, { name: 'quantity', label: 'quantity', optional: true }]} /></details></Section>}
    <Pagination offset={offset} hasNext={rows.length === 50} /></div></>;
}
