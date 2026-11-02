import {codeLabel} from '@/src/ui/presentation';
import {notFound} from 'next/navigation';
import {Header} from '@/components/layout/Header';
import {Section} from '../../ringkasan/_parts';
import {directPage} from '@/src/application/direct/page-context';
import {conversations,messages} from '@/src/application/operations/queries';
import {makeT} from '@/src/i18n';
import {isUuid} from '@/src/lib/uuidv5';
import {formatWib} from '@/src/lib/tz';
import {CommandForm} from '@/components/operations/CommandForm';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;if(!isUuid(id))notFound();const {tx,locale,can,actor}=await directPage();const t=makeT('ops',locale);const [c]=await tx(q=>conversations(q,id));if(!c)notFound();const rows=await tx(q=>messages(q,id));return <><Header title={c.flo_name}/><div className="direct-page"><p>{t('noProduction')}</p><Section id="messages" title={t('history')}>{rows.map(m=><article key={m.id} className={`direct-card message-${m.direction.toLowerCase()}`}><p className="text-caption">{codeLabel(m.direction,locale)} · {codeLabel(m.status,locale)} · {formatWib(m.created_at)}</p><p className="whitespace-pre-wrap">{m.body}</p></article>)}{!rows.length&&<p>{t('empty')}</p>}</Section>
 {can('conversation.takeover')&&<Section id="takeover" title={c.agent_paused?t('resume'):t('takeover')}><CommandForm url={`/api/conversations/${id}/${c.agent_paused?'resume':'takeover'}`} label={c.agent_paused?'resume':'takeover'} base={{expected_revision:c.revision}} fields={c.agent_paused?[{name:'summary',label:'summary',type:'textarea',min:10}]:[]}/></Section>}
 {can('message.send')&&c.agent_paused&&c.human_owner_id===actor.userId&&<Section id="send" title={t('send')}><CommandForm url={`/api/conversations/${id}/send`} label="send" base={{expected_revision:c.revision}} fields={[{name:'text',label:'text',type:'textarea'}]}/></Section>}
 {can('message.send')&&c.flo_contact_id&&<Section id="simulate" title={t('simulate')}><CommandForm url="/api/demo/simulate-flo" label="simulate" base={{event_id:crypto.randomUUID(),contact_id:c.flo_contact_id}} fields={[{name:'text',label:'text',type:'textarea'},{name:'offer_code',label:'offerCode',optional:true}]}/></Section>}</div></>;}
