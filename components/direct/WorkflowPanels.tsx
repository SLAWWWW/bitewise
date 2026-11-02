import Link from 'next/link';
import { StatusBadge } from '@/components/operations/RecordParts';
import { quantityLabel, codeLabel } from '@/src/ui/presentation';
import {CommandForm} from '@/components/operations/CommandForm';
import { CommandAction, OfferResponse, TransportForm } from './Actions';
import { Section } from '@/app/(ops)/ringkasan/_parts';
import type { Campaign } from '@/src/application/direct/queries';
import type { Actor } from '@/src/security/actor';
import { makeT } from '@/src/i18n';
import type { Locale } from '@/src/i18n/types';
import { formatWib } from '@/src/lib/tz';

export function WorkflowPanels({ campaigns, actor, locale }: { campaigns: Campaign[]; actor: Actor; locale: Locale }) {
  const t=makeT('direct',locale);const can=(cap:string)=>actor.capabilities.includes(cap as Actor['capabilities'][number]);
  return <div className="direct-stack">{campaigns.length===0&&<p>{t('noData')}</p>}{campaigns.map(c=><Section key={c.id} id={`campaign-${c.id}`} title={`${t('campaign')} · ${t(`state.${c.state}`)}`} >
    {c.state==='AWAITING_APPROVAL'&&<div data-tour="outreach-approval"><CommandAction url={`/api/campaigns/${c.id}/approve`} body={{expected_revision:c.revision}} label={t('approveOutreach')} reason allowed={can('outreach.approve')}/></div>}
    {c.state==='APPROVED'&&<CommandAction url={`/api/campaigns/${c.id}/start`} body={{expected_revision:c.revision}} label={t('start')} allowed={can('campaign.start')}/>}
    {c.offers.length>0&&<><h3 className="text-title-3">{t('offers')}</h3><div className="direct-grid">{c.offers.map(o=><article className="direct-card" key={o.id}>
      <p className="record-reference">{o.code}</p><h4 className="record-title">{o.flo_name}</h4><p className="record-quantity">{quantityLabel(o.quantity,o.unit,locale)}</p><StatusBadge code={o.state} locale={locale}/><p className="text-caption">{t('due')}: {formatWib(o.expires_at)}</p>
      {['SENT','DELIVERED'].includes(o.state)&&<OfferResponse offer={o} allowed={can('offer.respond')}/>}
    </article>)}</div></>}
    {c.allocations.length>0&&<><h3 className="text-title-3">{t('allocations')}</h3><div className="direct-grid">{c.allocations.map(a=><article className="direct-card" key={a.id}>
      <p className="record-reference">{a.code}</p><h4 className="record-title">{a.flo_name}</h4><p className="record-quantity">{quantityLabel(a.quantity,a.unit,locale)}</p><StatusBadge code={a.state} locale={locale}/>
      {a.transport_method&&<p className="text-caption">{codeLabel(a.transport_method,locale)} · {codeLabel(a.quote_status??'UNKNOWN',locale)}{a.fee_idr!=null?` · IDR ${a.fee_idr.toLocaleString('id-ID')}`:''}</p>}
      {['ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED'].includes(a.state)&&<details><summary>{t('transport')}</summary><TransportForm allocation={a} allowed={can('transport.edit')}/></details>}
      {a.state==='AWAITING_FINAL_APPROVAL'&&<div data-tour="dispatch-approval"><CommandAction url={`/api/allocations/${a.id}/approve-dispatch`} body={{expected_revision:a.revision}} label={t('approveDispatch')} reason allowed={can('dispatch.approve')}/></div>}
      {can('message.send')&&['OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED'].includes(a.state)&&<details><summary>{locale==='id'?'Tautan FLO privat':'Private FLO link'}</summary><CommandForm url="/api/flo-links" label="link" base={{subject_type:'ALLOCATION',subject_id:a.id,hours:72}}/></details>}
      {a.delivery_id&&<Link className="direct-link" href={`/pengiriman/${a.delivery_id}`}>{t('delivery')} →</Link>}
      {['OFFER_HELD','ACCEPTED_RESERVED','LOGISTICS_PENDING','AWAITING_FINAL_APPROVAL','APPROVED'].includes(a.state)&&<details><summary>{t('release')}</summary><CommandAction url={`/api/allocations/${a.id}/release`} body={{expected_revision:a.revision}} label={t('release')} reason reasonLabel={t('reason')} allowed={can('reservation.release')}/></details>}
    </article>)}</div></>}
  </Section>)}</div>;
}
