import Link from 'next/link';
import {codeLabel,quantityLabel} from '@/src/ui/presentation';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Section } from '../../ringkasan/_parts';
import {CommandForm,reason} from '@/components/operations/CommandForm';
import {DistributionForm} from '@/components/operations/StockForms';
import {receipts} from '@/src/application/operations/queries';
import {makeT} from '@/src/i18n';
import { DeliveryActions } from '@/components/direct/Actions';
import { directPage } from '@/src/application/direct/page-context';
import { listDeliveries } from '@/src/application/direct/queries';
import { isUuid } from '@/src/lib/uuidv5';
import { formatWib } from '@/src/lib/tz';
import { ArrowRight, ClipboardList, PackageCheck, Truck } from 'lucide-react';
import styles from '@/components/direct/DeliveryExperience.module.css';
export default async function DeliveryPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!isUuid(id))notFound();const {t,tx,can,locale}=await directPage();const d=(await tx(c=>listDeliveries(c,id)))[0];if(!d)notFound();const ot=makeT('ops',locale);const rs=await tx(c=>receipts(c,id));const now=await tx(async c=>(await c.query<{now:string}>('SELECT lumbung.tenant_now()::text AS now')).rows[0].now);
 const pick=await tx(async c=>(await c.query<{id:string;revision:number;state:string;lines:{id:string;batch_code:string;planned_qty:string}[]}>(`SELECT pl.id,pl.revision,pl.state,coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'batch_code',b.batch_code,'planned_qty',l.planned_qty::text)) FROM lumbung.pick_lines l JOIN lumbung.inventory_batches b ON b.id=l.batch_id WHERE l.pick_list_id=pl.id),'[]') AS lines FROM lumbung.pick_lists pl WHERE pl.delivery_id=$1 ORDER BY pl.created_at DESC LIMIT 1`,[id])).rows[0]);
  return <><Header title={d.flo_name} eyebrow={<Link className="direct-link" href="/pengiriman">← {t('deliveries')}</Link>} subtitle={`${d.code} · ${codeLabel(d.state,locale)}`}/><div className={styles.page}>
    <section className={styles.hero} aria-labelledby="delivery-snapshot">
      <div className={styles.heroContent}>
        <div className={styles.heroTopline}><span className={styles.statusBadge}><Truck size={14} aria-hidden="true"/>{codeLabel(d.state,locale)}</span><span className={styles.routeBadge}>{codeLabel(d.route,locale)}</span></div>
        <p className={styles.heroEyebrow}>{d.code}</p>
        <h2 id="delivery-snapshot" className={styles.heroTitle}>{d.flo_name}</h2>
        <p className={styles.heroDescription}>{locale==='en'?'Review the handover details and complete the recipient safety inspection before closing this delivery.':'Tinjau rincian serah terima dan selesaikan pemeriksaan keamanan penerima sebelum menutup pengiriman ini.'}</p>
      </div>
      <div className={styles.heroItems}>
        <p className={styles.heroItemsLabel}><PackageCheck size={16} aria-hidden="true"/>{locale==='en'?'Shipment contents':'Isi pengiriman'}</p>
        {d.lines.map((l,i)=><div className={styles.heroItem} key={i}><span>{l.description}</span><strong>{quantityLabel(l.dispatched_qty??l.allocated_qty,l.unit,locale)}</strong></div>)}
      </div>
    </section>
    <div className={styles.workspace}>
      <div>{['READY_FOR_PICKUP','IN_TRANSIT'].includes(d.state)&&<DeliveryActions delivery={d} dispatchAllowed={can('delivery.dispatch')} receiveAllowed={can('delivery.receive')}/>}</div>
      <aside className={styles.sideColumn}>
        <section className={styles.sideCard} aria-labelledby="reporting-title">
          <h2 id="reporting-title" className={styles.sideHeading}><span className={styles.sideHeadingIcon}><ClipboardList size={17} aria-hidden="true"/></span>{t('obligations')}</h2>
          <p className={styles.sideCopy}>{t('actual')}</p>
          <div className={styles.obligationList}>{d.obligations.map(o=><Link className={styles.obligationLink} href={`/pelaporan/${o.id}`} key={o.type}><span><span className={styles.obligationLabel}>{codeLabel(o.type,locale)} · {codeLabel(o.state,locale)}</span><span className={styles.obligationDue}>{t('due')}: {formatWib(o.due_at)}</span></span><ArrowRight size={16} aria-hidden="true"/></Link>)}{!d.obligations.length&&<p className={styles.sideCopy}>{t('noData')}</p>}</div>
        </section>
      </aside>
    </div>
    {pick?.state==='OPEN'&&can('inventory.pick')&&<Section id="pick" title={ot('pick')}><p>{pick.lines.map(l=>`${l.batch_code}: ${l.planned_qty}`).join(' / ')}</p><CommandForm url={`/api/deliveries/${id}/pick`} label="pick" base={{expected_revision:pick.revision,lines:pick.lines.map(l=>({pick_line_id:l.id}))}} fields={[...pick.lines.flatMap((l,i)=>[{name:`lines.${i}.picked_quantity`,label:'quantity',type:'quantity' as const,value:l.planned_qty},{name:`lines.${i}.substitute_batch_id`,label:'substitute',optional:true}]),reason]}/></Section>}
    {can('message.send')&&<details className={styles.detailsCard}><summary>{ot('link')}</summary><p>{ot('linkWarning')}</p><CommandForm url="/api/flo-links" label="link" base={{subject_type:'DELIVERY',subject_id:id,hours:72}}/></details>}
    {rs.map(r=><Section key={`inspection-${r.id}`} id={`inspection-${r.id}`} title={ot('recipientInspection')} subtitle={r.inspection_outcome?codeLabel(r.inspection_outcome,locale):ot('inspectionUnavailable')}>
      {r.inspection_observations?<><p>{ot('smell')}: {codeLabel(r.inspection_observations.smell,locale)} · {ot('appearance')}: {codeLabel(r.inspection_observations.appearance,locale)} · {ot('texture')}: {codeLabel(r.inspection_observations.texture,locale)}</p><p>{ot('packaging')}: {codeLabel(r.inspection_observations.packaging,locale)} · {ot('taste')}: {codeLabel(r.inspection_observations.taste,locale)}</p>{r.inspection_observations.notes&&<p>{r.inspection_observations.notes}</p>}</>:<p>{ot('inspectionUnavailable')}</p>}
    </Section>)}
    {can('evidence.submit')&&rs.map(r=><Section key={r.id} id={`distribution-${r.id}`} title={ot('distribution')}><DistributionForm receipt={r} now={now}/></Section>)}
    {can('receipt.correct')&&rs.map(r=><details key={r.id} className={styles.detailsCard}><summary>{ot('correction')}</summary><CommandForm url={`/api/receipts/${r.id}/corrections`} label="correction" base={{lines:r.lines.map(l=>({receipt_line_id:l.id}))}} fields={[...r.lines.flatMap((l,i)=>[{name:`lines.${i}.accepted_quantity`,label:'accepted',type:'quantity' as const,value:l.accepted_qty},{name:`lines.${i}.rejected_quantity`,label:'rejected',type:'quantity' as const,value:l.rejected_qty}]),reason]}/></details>)}
  </div></>;
}
