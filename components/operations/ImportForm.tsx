'use client';
import {useId} from 'react';
import {useCommand} from '@/components/flo/useCommand';
import {Button} from '@/components/ui/Button';
import {useT} from '@/src/i18n/client';
export function ImportForm(){const t=useT('ops');const cmd=useCommand<{id:string;rows:number;errors:number}>();const id=useId();return <form className="direct-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const file=f.get('csv');if(!(file instanceof File)||file.size>2*1024*1024)return;await cmd.run('/api/imports/preview','POST',{kind:f.get('kind'),csv:await file.text()},{navigateTo:undefined});}}>
 <label className="direct-field" htmlFor={id+'kind'}>{t('kind')}<select id={id+'kind'} name="kind"><option value="RECEIPTS">RECEIPTS</option><option value="FLOS">FLOS</option><option value="DONATIONS">DONATIONS</option></select></label><label className="direct-field" htmlFor={id+'file'}>{t('csv')}<input id={id+'file'} name="csv" type="file" accept="text/csv,.csv" required/></label><Button type="submit" loading={cmd.pending}>{t('preview')}</Button>{cmd.error&&<p role="alert">{cmd.error.code}: {cmd.error.message}</p>}{cmd.result&&<p role="status">{t('total')}: {cmd.result.rows} · errors: {cmd.result.errors}</p>}</form>;}
