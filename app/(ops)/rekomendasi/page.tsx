import {Pagination} from '@/components/operations/Pagination';
import {readPage} from '@/src/ui/pagination';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Section } from '../ringkasan/_parts';
import { directPage } from '@/src/application/direct/page-context';
import { listRuns } from '@/src/application/direct/queries';
import { formatWib } from '@/src/lib/tz';
export default async function RecommendationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const offset=await readPage(searchParams);const {t,tx}=await directPage();const rows=await tx(c=>listRuns(c,null,offset));
  return <><Header title={t('recommendations')}/><div className="direct-page"><Section id="recommendations" title={t('recommendations')}>
    {rows.map(r=><p className="direct-card" key={r.id}><Link className="direct-link" href={`/rekomendasi/${r.id}`}>{r.order_code} · {formatWib(r.created_at)}</Link></p>)}
    {!rows.length&&<p>{t('noData')}</p>}
  </Section><Pagination offset={offset} hasNext={rows.length===50}/></div></>;
}
