'use client';
import {useId,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {Button} from '@/components/ui/Button';
import {useCommand} from '@/components/flo/useCommand';
import {useT} from '@/src/i18n/client';
export interface FieldSpec {name:string;label:string;type?:'text'|'number'|'quantity'|'datetime-local'|'checkbox'|'textarea'|'select';value?:string|number|boolean;options?:{value:string;label:string}[];optional?:boolean;min?:number;max?:number}
export function Field({label,children}:{label:string;children:ReactNode}){const id=useId();return <label className="direct-field" htmlFor={id}><span>{label}</span><span id={id}>{children}</span></label>;}
function put(object:Record<string,unknown>,path:string[],value:unknown){let node:Record<string,unknown>|unknown[]=object;path.forEach((key,i)=>{if(i===path.length-1){(node as Record<string,unknown>)[key]=value;return;}let next=(node as Record<string,unknown>)[key];if(!next){next=/^\d+$/.test(path[i+1])?[]:{};(node as Record<string,unknown>)[key]=next;}node=next as Record<string,unknown>;});}
export function CommandForm({url,fields=[],base={},label='submit',allowed=true,token,navigatePrefix,wrap,children}:{url:string;fields?:FieldSpec[];base?:Record<string,unknown>;label?:string;allowed?:boolean;token?:string;navigatePrefix?:string;wrap?:{action:string;offer_id?:string};children?:ReactNode}){
 const t=useT('ops');const dt=useT('direct');const id=useId();const router=useRouter();const cmd=useCommand<{id:string;path?:string}>();
 return <form className="direct-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const body=structuredClone(base);
 fields.forEach(field=>{const raw=f.get(field.name);if(field.optional&&(raw===null||raw===''))return;
 const value=field.type==='checkbox'?raw==='on':field.type==='number'?Number(raw):field.type==='datetime-local'?`${raw}:00+07:00`:String(raw??'');put(body,field.name.split('.'),value);});
 const res=await cmd.run(url,'POST',wrap?{...wrap,payload:body}:body,{headers:token?{'x-flo-token':token}:undefined});if(res&&navigatePrefix)router.push(`${navigatePrefix}/${res.id}`);
 }}>
 {fields.map((f,index)=>{const inputId=`${id}-${index}`;const required=!f.optional;return <div key={f.name} className="direct-field"><label htmlFor={inputId}>{t(f.label)}</label>{f.type==='select'?<select id={inputId} name={f.name} defaultValue={String(f.value??f.options?.[0]?.value??'')} required={required}>{f.optional&&<option value="">—</option>}{f.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:f.type==='textarea'?<textarea id={inputId} name={f.name} defaultValue={String(f.value??'')} required={required} minLength={f.min} maxLength={6000} rows={3}/>:f.type==='checkbox'?<input id={inputId} name={f.name} type="checkbox" defaultChecked={Boolean(f.value)} required={required}/>:<input id={inputId} name={f.name} type={f.type==='quantity'?'text':f.type??'text'} inputMode={f.type==='quantity'?'decimal':undefined} pattern={f.type==='quantity'?'[0-9]+([.][0-9]{1,3})?':undefined} min={f.min} max={f.max} step={f.type==='number'?'any':undefined} defaultValue={String(f.value??'')} required={required} maxLength={f.type==='text'?3000:undefined}/> }</div>;})}
 {children}<div><Button type="submit" loading={cmd.pending} disabledReason={allowed?null:dt('permission')}>{t(label)}</Button></div>
 {cmd.error&&<p role="alert" className="direct-error">{cmd.error.code}: {cmd.error.message}</p>}{cmd.result&&<p role="status">{dt('saved')}</p>}{cmd.result?.path&&<p><a className="direct-link break-all" href={cmd.result.path}>{cmd.result.path}</a></p>}
 </form>;
}
export const reason:FieldSpec={name:'reason',label:'reason',type:'textarea',min:3};
export function dateField(name:string,label:string,value:string):FieldSpec{return {name,label,type:'datetime-local',value:new Date(Date.parse(value)+7*3600000).toISOString().slice(0,16)};}
