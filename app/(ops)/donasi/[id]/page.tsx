import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Section } from '../../ringkasan/_parts';
import { CommandAction, PlanForm, SafetyCorrection } from '@/components/direct/Actions';
import { WorkflowPanels } from '@/components/direct/WorkflowPanels';
import { directPage } from '@/src/application/direct/page-context';
import { getDonation,listCampaigns,listRuns } from '@/src/application/direct/queries';
import { isUuid } from '@/src/lib/uuidv5';
import { formatWib } from '@/src/lib/tz';
export default async function DonationPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!isUuid(id))notFound();const {actor,locale,t,tx,can}=await directPage();
  const data=await tx(async c=>({order:await getDonation(c,id),campaigns:await listCampaigns(c,id),runs:await listRuns(c,id),now:(await c.query<{now:Date}>('SELECT lumbung.tenant_now() AS now')).rows[0].now.toISOString()}));
  const o=data.order;if(!o)notFound();
  return <><Header title={o.code}/><div className="direct-page"><Link className="direct-link" href="/donasi">← {t('donations')}</Link>
    <Section id="order" title={o.donor_name} subtitle={`${o.source_name} · ${o.route} · ${t(`state.${o.operational_state}`)}`}>
      <p>{formatWib(o.pickup_start)} → {formatWib(o.pickup_end)}</p>
      {['DRAFT','NEEDS_INFO','SAFETY_REVIEW','READY'].includes(o.operational_state)&&<CommandAction url={`/api/donations/${id}/validate`} body={{expected_revision:o.revision}} label={t('validate')} allowed={can('donation.validate')}/>}
    </Section>
    {o.items.map(i=><Section key={i.id} id={`item-${i.id}`} title={`${i.description} · ${i.quantity} ${i.unit}`} subtitle={t(`state.${i.safety_state}`)}>
      <p className="text-caption">{t('distributeBy')}: {formatWib(i.distribute_by)}</p>
      <p>{t('remainder')}: {i.available_quantity??'—'} {i.unit}</p>
      {i.missing_fields.length>0&&<p role="status">{i.missing_fields.join(' · ')} · {t('safetyPending')}</p>}
      {['DRAFT','NEEDS_INFO','SAFETY_REVIEW','READY'].includes(o.operational_state)&&i.safety_state!=='CLEARED'&&<SafetyCorrection itemId={i.id} revision={i.revision} now={data.now} allowed={can('donation.validate')}/>}
      {i.safety_state==='CLEARED'&&o.route==='DIRECT'&&<PlanForm itemId={i.id} now={data.now} allowed={can('allocation.run')}/>}
    </Section>)}
    {data.runs.length>0&&<Section id="runs" title={t('recommendations')}>{data.runs.map(r=><p key={r.id}><Link className="direct-link" href={`/rekomendasi/${r.id}`}>{t('view')} · {formatWib(r.created_at)}</Link></p>)}</Section>}
    <WorkflowPanels campaigns={data.campaigns} actor={actor} locale={locale}/>
  </div></>;
}
