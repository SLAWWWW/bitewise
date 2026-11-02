import Link from 'next/link';
import {getT} from '@/src/i18n/server';
import {pageToken,PAGE_SIZE} from '@/src/ui/pagination';
export async function Pagination({offset,hasNext}:{offset:number;hasNext:boolean}){const t=await getT('ops');return <nav aria-label={t('pagination')} className="flex flex-wrap gap-4 mt-4">{offset>0&&<Link className="direct-link" href={`?cursor=${pageToken(Math.max(0,offset-PAGE_SIZE))}`}>← {t('previous')}</Link>}{hasNext&&<Link className="direct-link" href={`?cursor=${pageToken(offset+PAGE_SIZE)}`}>{t('next')} →</Link>}</nav>;}
