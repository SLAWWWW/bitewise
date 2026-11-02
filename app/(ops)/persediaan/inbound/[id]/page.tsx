import {notFound} from 'next/navigation';
import {Header} from '@/components/layout/Header';
import {Section} from '../../../ringkasan/_parts';
import {directPage} from '@/src/application/direct/page-context';
import {inbounds,references} from '@/src/application/operations/queries';
import {makeT} from '@/src/i18n';
import {isUuid} from '@/src/lib/uuidv5';
import {InspectionForm} from '@/components/operations/StockForms';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;if(!isUuid(id))notFound();const {tx,locale,can}=await directPage();const t=makeT('ops',locale);const [b]=await tx(c=>inbounds(c,id));if(!b)notFound();const refs=await tx(references);return <><Header title={`${t('inspect')} · ${b.donor_name}`}/><div className="direct-page"><p>{b.state}</p><Section id="inspection" title={t('inspect')}>{can('inventory.inspect')&&b.state!=='CLOSED'?<InspectionForm inbound={b} refs={refs}/>:b.lines.map(l=><p key={l.id}>{l.name} · {l.received_qty} / {l.expected_qty} {l.unit}</p>)}</Section></div></>;}
