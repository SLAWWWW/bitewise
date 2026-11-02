import Link from 'next/link';
import {Section} from '@/app/(ops)/ringkasan/_parts';
import {PolicyEditor,MemberEditor} from './AdminForms';
import {CommandForm,reason} from './CommandForm';
import {makeT,type Locale} from '@/src/i18n';
import type {Queryable} from '@/src/db/types';
export async function AdminPanel({tx,can,locale}:{tx:<T>(fn:(c:Queryable)=>Promise<T>)=>Promise<T>;can:(cap:string)=>boolean;locale:Locale}){const t=makeT('ops',locale);const data=await tx(async c=>({policies:can('policy.manage')?(await c.query<{id:string;kind:string;body:Record<string,unknown>}>('SELECT p.id,p.kind,p.body FROM lumbung.policy_versions p JOIN lumbung.tenant_active_policies a ON a.policy_version_id=p.id ORDER BY p.kind')).rows:[],
 members:can('users.manage')?(await c.query<{id:string;display_name:string;role_label:string;status:string;capabilities:string[]}>('SELECT m.id,u.display_name,m.role_label,m.status,m.capabilities FROM lumbung.memberships m JOIN lumbung.users u ON u.id=m.user_id ORDER BY u.display_name')).rows:[],
 decisions:can('policy.manage')?(await c.query<{id:string;key:string;status:string}>('SELECT id,key,status FROM lumbung.activation_decisions ORDER BY key')).rows:[]}));return <><p><Link className="direct-link" href="/pengaturan/impor">{t('imports')} →</Link></p>
 {data.policies.length>0&&<Section id="edit-policies" title={t('policies')}><p>{t('noProduction')}</p>{data.policies.map(p=><details className="direct-card" key={p.id}><summary>{p.kind}</summary><PolicyEditor id={p.id} body={p.kind==='RETENTION'?{agreement_retention_days:90,contact_retention_days:90,message_retention_days:90,...p.body}:p.body}/></details>)}</Section>}
 {data.members.length>0&&<Section id="members" title={t('members')}>{data.members.map(m=><details className="direct-card" key={m.id}><summary>{m.display_name} · {m.role_label} · {m.status}</summary><MemberEditor member={m}/></details>)}</Section>}
 {data.decisions.map(d=><details key={d.id} className="direct-card"><summary>{d.key} · {d.status}</summary><CommandForm url={`/api/activation-decisions/${d.id}`} base={{status:d.status==='APPROVED'?'NOT_DECIDED':'APPROVED'}} fields={[reason]}/></details>)}</>;}
