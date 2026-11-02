import {codeLabel} from '@/src/ui/presentation';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {Header} from '@/components/layout/Header';
import {Section} from '../../ringkasan/_parts';
import {directPage} from '@/src/application/direct/page-context';
import {obligations,submissions} from '@/src/application/operations/queries';
import {makeT} from '@/src/i18n';
import {formatWib} from '@/src/lib/tz';
import {isUuid} from '@/src/lib/uuidv5';
import {EvidenceForm,MediaLink} from '@/components/operations/EvidenceForm';
import {CommandForm,reason} from '@/components/operations/CommandForm';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;if(!isUuid(id))notFound();const {tx,locale,can}=await directPage();const t=makeT('ops',locale);const [o]=await tx(c=>obligations(c,id));if(!o)notFound();const versions=await tx(c=>submissions(c,id));return <><Header title={o.flo_name} eyebrow={codeLabel(o.type,locale)}/><div className="direct-page"><Link className="direct-link" href={`/pengiriman/${o.delivery_id}`}>{t('open')} →</Link><p>{codeLabel(o.state,locale)} · {t('due')}: {formatWib(o.due_at)}{o.resolved_timeliness?` · ${codeLabel(o.resolved_timeliness,locale)}`:''}</p>{o.excuse_explanation&&<p>{o.excuse_explanation}</p>}
 {can('evidence.submit')&&!['ACCEPTED','EXCUSED','REJECTED_FINAL'].includes(o.state)&&<Section id="submit" title={t('evidence')}><EvidenceForm id={id} revision={o.revision} deliveryId={o.delivery_id}/></Section>}
 {can('evidence.review')&&versions.length>0&&['SUBMITTED','UNDER_REVIEW'].includes(o.state)&&<Section id="review" title={t('review')}><CommandForm url={`/api/submissions/${versions[0].id}/review`} label="review" base={{expected_revision:o.revision}} fields={[
 {name:'outcome',label:'outcome',type:'select',options:['ADEQUATE','NEEDS_CLARIFICATION','REJECTED_FINAL'].map(value=>({value,label:t(value)}))},{name:'checklist.correct_subject',label:'correctSubject',type:'checkbox',optional:true},{name:'checklist.quantity_plausible',label:'plausible',type:'checkbox',optional:true},{name:'checklist.privacy_appropriate',label:'privacy',type:'checkbox',optional:true},{name:'comments',label:'reason',type:'textarea',min:3}]}/></Section>}
 {can('evidence.excuse')&&<details className="direct-card"><summary>{t('excuse')}</summary><CommandForm url={`/api/obligations/${id}/excuse`} label="excuse" base={{expected_revision:o.revision}} fields={[{name:'category',label:'category'},reason]}/></details>}
 <Section id="versions" title={t('versions')}>{versions.map(s=><article key={s.id} className="direct-card"><h3>v{s.version} · {formatWib(s.submitted_at)}</h3><p className="whitespace-pre-wrap">{s.note}</p>{s.media.map(m=><p key={m.id}><MediaLink id={m.id}/></p>)}{s.reviews.map((r,i)=><p key={i}>{codeLabel(r.outcome,locale)} · {r.comments} · {formatWib(r.reviewed_at)}</p>)}</article>)}{!versions.length&&<p>{t('empty')}</p>}</Section></div></>;}
