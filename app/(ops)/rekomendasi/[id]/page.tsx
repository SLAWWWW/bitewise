import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Section } from '../../ringkasan/_parts';
import { PlanChoiceForm } from '@/components/direct/Actions';
import { directPage } from '@/src/application/direct/page-context';
import type { Plan,RankedCandidate } from '@/src/domain/allocation/planner';
import { isUuid } from '@/src/lib/uuidv5';
export default async function RecommendationPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!isUuid(id))notFound();const {t,tx,can}=await directPage();
  const r=await tx(async c=>(await c.query<{result:Plan;order_id:string|null;order_code:string;unit:string}>(`SELECT r.result,i.order_id,coalesce(o.code,'WAREHOUSE') AS order_code,coalesce(i.unit,p.base_unit) AS unit FROM lumbung.allocation_runs r
    LEFT JOIN lumbung.donation_items i ON i.id=r.item_id LEFT JOIN lumbung.donation_orders o ON o.id=i.order_id LEFT JOIN lumbung.release_plans rp ON rp.id=r.release_plan_id LEFT JOIN lumbung.products p ON p.id=rp.product_id WHERE r.id=$1::uuid`,[id])).rows[0]);
  if(!r)notFound();if(!r.result.selected)return <><Header title={t('recommendations')}/><p>{t('noData')}</p></>;
  function candidate(c:RankedCandidate,quantity?:string){return <article className="direct-card" key={c.flo_id}>
    <h3><Link className="direct-link" href={`/flo/${c.flo_id}`}>{c.code} · {c.name}</Link></h3>
    {quantity&&<p className="text-title-2">{quantity} {r.unit}</p>}<p>{t('score')}: {c.score.toFixed(2)} · {t('capacity')}: {c.capacity} {r.unit}</p>
    <p className="text-caption">{t('factors')}</p><p>{Object.entries(c.factors).map(([k,v])=>`${k}: ${v.toFixed(3)}`).join(' · ')}</p>
    <p>{t('coverage')}: {c.coverage==null?'UNKNOWN':`${(100*c.coverage).toFixed(1)}%`} · {t('samples')}: {c.response_samples} / {c.reporting_samples}</p>
    <p>{t('history')}: {c.received_7} / {c.received_30} {r.unit} · {t('incoming')}: {c.committed} {r.unit}</p>
    <p className="text-caption">{t('travel')}: {c.travel.minutes} min · {c.travel.source}</p>
    {c.flags.length>0&&<p className="text-caption">{t('flags')}: {c.flags.join(' · ')}</p>}
  </article>;}
  return <><Header title={t('recommendations')}/><div className="direct-page"><Link className="direct-link" href={r.order_id?`/donasi/${r.order_id}`:'/persetujuan'}>← {r.order_code}</Link>
    <Section id="selected" title={t('selected')} subtitle={`${t('remainder')}: ${r.result.unallocated_quantity} ${r.unit}`}>
      <div className="direct-grid">{r.result.selected.map(c=>candidate(c,c.quantity))}</div>
      {r.result.selected.length>0&&<PlanChoiceForm runId={id} orderId={r.order_id} plan={r.result} unit={r.unit} allowed={can('allocation.run')}/>}
      <Link className="direct-link" href={r.order_id?`/donasi/${r.order_id}`:'/persetujuan'}>{t('approvals')} →</Link>
    </Section>
    <Section id="alternatives" title={t('alternatives')}><div className="direct-grid">{r.result.alternatives.map(c=>candidate(c))}</div></Section>
    <Section id="excluded" title={`${t('excluded')} (${r.result.excluded.length})`}><div className="direct-grid">{r.result.excluded.map(c=><article className="direct-card" key={c.flo_id}><h3>{c.code} · {c.name}</h3><p className="text-caption">{c.reasons.join(' · ')}</p></article>)}</div></Section>
  </div></>;
}
