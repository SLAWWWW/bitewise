'use client';
import {useId,useRef,useState} from 'react';
import {Button} from '@/components/ui/Button';
import {useCommand} from '@/components/flo/useCommand';
import {useT} from '@/src/i18n/client';
export function Upload({subject,purpose,token,onUploaded}:{subject:string;purpose:string;token?:string;onUploaded?:(id:string)=>void}){
 const t=useT('ops');const id=useId();const key=useRef<string>('');const [state,setState]=useState('');const [busy,setBusy]=useState(false);
 return <form className="direct-form" onSubmit={async e=>{e.preventDefault();const file=new FormData(e.currentTarget).get('file');if(!(file instanceof File))return;if(file.size>10485760){setState('UPLOAD_TOO_LARGE');return;}key.current ||=crypto.randomUUID();setBusy(true);
 try{const response=await fetch('/api/uploads',{method:'POST',headers:{'content-type':file.type,'x-subject-id':subject,'x-upload-purpose':purpose,'Idempotency-Key':key.current,...(token?{'x-flo-token':token}:{})},body:file});const json=await response.json();if(!response.ok)throw Error(json.error?.message??'UPLOAD_FAILED');setState(json.data.duplicate?t('duplicate'):t('uploaded'));onUploaded?.(json.data.id);key.current='';}catch(e){setState(String(e));}finally{setBusy(false);}}}>
 <label className="direct-field" htmlFor={id}>{t('photo')}<input id={id} name="file" type="file" accept="image/jpeg,image/png,application/pdf" required onChange={()=>{key.current='';}}/></label><Button type="submit" loading={busy}>{t('upload')}</Button>{state&&<p role="status">{state}</p>}</form>;
}
export function EvidenceForm({id,revision,deliveryId,token}:{id:string;revision:number;deliveryId:string;token?:string}){
 const t=useT('ops');const cmd=useCommand();const inputId=useId();const [media,setMedia]=useState<string[]>([]);
 return <div className="direct-stack"><Upload subject={deliveryId} purpose="EVIDENCE" token={token} onUploaded={id=>setMedia(prev=>[...prev,id])}/><form className="direct-form" onSubmit={async e=>{e.preventDefault();await cmd.run(`/api/obligations/${id}/submissions`,'POST',{expected_revision:revision,note:String(new FormData(e.currentTarget).get('note')),media_ids:media},{headers:token?{'x-flo-token':token}:undefined});}}>
 <label className="direct-field" htmlFor={inputId}>{t('note')}<textarea id={inputId} name="note" required={media.length===0} minLength={media.length?undefined:10} maxLength={6000} rows={3}/></label><p>{media.length} {t('files')}</p><Button type="submit" loading={cmd.pending}>{t('evidence')}</Button>{cmd.error&&<p role="alert">{cmd.error.code}: {cmd.error.message}</p>}{cmd.result!=null&&<p role="status">{t('submit')} ✓</p>}</form></div>;
}
export function MediaLink({id,token}:{id:string;token?:string}){const t=useT('ops');const [error,setError]=useState('');return <><button className="direct-link" type="button" onClick={async()=>{const response=await fetch(`/api/media/${id}`,{headers:token?{'x-flo-token':token}:{}});const json=await response.json();if(!response.ok){setError(json.error?.message??'FORBIDDEN');return;}const href=json.data.url??json.data.path;window.open(href,'_blank','noopener,noreferrer');}}>{t('open')} {id.slice(0,8)}</button>{error&&<p role="alert">{error}</p>}</>;}
