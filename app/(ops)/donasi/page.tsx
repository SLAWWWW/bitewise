import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Pagination } from '@/components/operations/Pagination';
import { RecordList } from '@/components/operations/RecordList';
import { RecordHeading, RecordFacts, RecordFact, StatusBadge } from '@/components/operations/RecordParts';
import { Section } from '../ringkasan/_parts';
import { directPage } from '@/src/application/direct/page-context';
import { listDonations } from '@/src/application/direct/queries';
import { formatWib } from '@/src/lib/tz';
import { readPage } from '@/src/ui/pagination';
import { codeLabel, quantityLabel } from '@/src/ui/presentation';
export const metadata = { title: 'Donasi — Lumbung' };

export default async function DonationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const offset = await readPage(searchParams);
  const { t, tx, can, locale } = await directPage();
  const rows = await tx(c => listDonations(c, offset));
  const id = locale === 'id';
  return <><Header title={t('donations')} action={can('donation.create') ? <Link className="btn btn-primary" href="/donasi/baru">{t('newDonation')}</Link> : undefined} />
    <div className="direct-page"><p className="text-body">{id ? 'Periksa donasi masuk, lalu buka rinciannya untuk validasi dan alokasi.' : 'Review incoming donations, then open a record to validate and allocate it.'}</p>
      <Section id="donations" title={id ? 'Daftar donasi' : 'Donation list'}>
        <RecordList records={rows.map(o => ({ id: o.id, search: `${o.code} ${o.donor_name} ${o.source_name} ${o.items.map(i => i.description).join(' ')}`, status: codeLabel(o.operational_state, locale), content: <>
          <RecordHeading href={`/donasi/${o.id}`} title={o.donor_name} code={o.code} />
          <div className="record-detail"><RecordFacts><RecordFact label={t('product')}>{o.items.map((i, index) => <p key={index}><strong>{quantityLabel(i.quantity, i.unit, locale)}</strong> · {i.description}</p>)}</RecordFact><RecordFact label={id ? 'Jalur & sumber' : 'Route & source'}>{codeLabel(o.route, locale)} · {o.source_name}</RecordFact>{o.pickup_start && <RecordFact label={id ? 'Jadwal pengambilan' : 'Pickup window'}>{formatWib(o.pickup_start, { locale })} – {formatWib(o.pickup_end, { locale })}</RecordFact>}</RecordFacts></div>
          <StatusBadge code={o.operational_state} locale={locale} />
        </> }))} />
      </Section><Pagination offset={offset} hasNext={rows.length === 50} />
    </div></>;
}
