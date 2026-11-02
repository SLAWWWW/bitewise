import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Pagination } from '@/components/operations/Pagination';
import { RecordList } from '@/components/operations/RecordList';
import { RecordHeading, RecordFacts, RecordFact, StatusBadge } from '@/components/operations/RecordParts';
import { InboundForm, ReleaseForm } from '@/components/operations/StockForms';
import { Section } from '../ringkasan/_parts';
import { directPage } from '@/src/application/direct/page-context';
import { batches, inbounds, references } from '@/src/application/operations/queries';
import { makeT } from '@/src/i18n';
import { formatWib } from '@/src/lib/tz';
import { readPage } from '@/src/ui/pagination';
import { codeLabel, quantityLabel, stockStatus } from '@/src/ui/presentation';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const offset = await readPage(searchParams);
  const { tx, locale, can } = await directPage();
  const t = makeT('ops', locale);
  const id = locale === 'id';
  const [stock, incoming, refs] = await tx(async c => [await batches(c, null, offset), await inbounds(c, null, offset), await references(c)] as const);
  return <><Header title={t('inventory')} /><div className="direct-page"><p className="text-body">{id ? 'Saldo tercatat belum berarti stok boleh disalurkan. Periksa inspeksi, pembatasan, dan batas keamanan di setiap batch.' : 'A recorded balance does not mean stock is eligible for release. Check each batch’s inspection, restrictions, and safety deadlines.'}</p>
    <Section id="stock" title={t('batches')}><RecordList records={stock.map(b => ({ id: b.id, search: `${b.batch_code} ${b.name} ${b.warehouse}`, status: codeLabel(stockStatus(b, refs.now), locale), content: <>
      <RecordHeading href={`/persediaan/batch/${b.id}`} title={b.name} code={b.batch_code} />
      <div className="record-detail"><RecordFacts><RecordFact label={t('warehouse')}>{b.warehouse}</RecordFact><RecordFact label={t('expiry')}>{b.expires_at ? formatWib(b.expires_at, { locale }) : codeLabel('UNKNOWN', locale)}</RecordFact>{b.handling_deadline && <RecordFact label={id ? 'Batas penanganan' : 'Handling deadline'}>{formatWib(b.handling_deadline, { locale })}</RecordFact>}</RecordFacts>
        <dl className="stock-totals">{['AVAILABLE', 'RESERVED', 'QUARANTINE'].map(account => <div key={account}><dt>{codeLabel(account, locale)}</dt><dd>{quantityLabel(b.balances[account] ?? '0', b.base_unit, locale)}</dd></div>)}</dl>
        <details className="record-more"><summary>{id ? 'Lihat semua saldo' : 'View all balances'}</summary><RecordFacts>{Object.entries(b.balances).map(([account, value]) => <RecordFact key={account} label={account === 'DELIVERED' ? (id ? 'Tersalurkan' : 'Delivered') : codeLabel(account, locale)}>{quantityLabel(value, b.base_unit, locale)}</RecordFact>)}</RecordFacts></details>
      </div><StatusBadge code={stockStatus(b, refs.now)} locale={locale} />
    </> }))} /></Section>
    <Section id="inbound" title={id ? 'Barang masuk' : 'Inbound goods'}><div className="direct-stack">{incoming.map(b => <article key={b.id} className="record-row"><RecordHeading href={`/persediaan/inbound/${b.id}`} title={b.donor_name} /><RecordFacts><RecordFact label={t('expected')}>{formatWib(b.expected_at, { locale })}</RecordFact></RecordFacts><StatusBadge code={b.state} locale={locale} /></article>)}</div>{can('inventory.receive') && <details className="record-more"><summary>{t('newInbound')}</summary><InboundForm refs={refs} /></details>}</Section>
    {can('allocation.run') && <Section id="release" title={t('release')}><details><summary>{id ? 'Buka formulir rencana pelepasan' : 'Open the stock release form'}</summary><ReleaseForm refs={refs} /></details></Section>}
    <Pagination offset={offset} hasNext={stock.length === 50 || incoming.length === 50} />
    <Link className="direct-link" href="/pengiriman">{id ? 'Lihat pengiriman dari gudang' : 'View warehouse deliveries'}</Link>
  </div></>;
}
