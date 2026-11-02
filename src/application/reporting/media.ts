import 'server-only';
import { createHmac,timingSafeEqual,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,unlink } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '@/src/config/env';
import { withTx } from '@/src/db/tx';
import type { DbCtx } from '@/src/db/types';
import { DomainError } from '@/src/db/errors';
import { isUuid } from '@/src/lib/uuidv5';
import { readUpload } from '@/src/security/upload-guards';
import {sha256Hex} from '@/src/lib/hash';

function storagePath(tenant:string,id:string){
  if(!isUuid(tenant)||!isUuid(id))throw new DomainError({code:'NOT_FOUND'});
  return path.resolve(getEnv().MEDIA_DIR,tenant,id);
}
export async function storeUpload(ctx:DbCtx,request:Request,key:string,hash:string){
  const subject=request.headers.get('x-subject-id');const purpose=request.headers.get('x-upload-purpose')??'EVIDENCE';
  if(!subject||!isUuid(subject)||!['EVIDENCE','AGREEMENT','COUNT'].includes(purpose))throw new DomainError({code:'BAD_REQUEST'});
  const file=await readUpload(request);const id=randomUUID();const filename=storagePath(ctx.tenantId!,id);
  await mkdir(path.dirname(filename),{recursive:true,mode:0o700});await writeFile(filename,file.bytes,{flag:'wx',mode:0o600});
  try{
    const result=await withTx(ctx,async c=>(await c.query<{v:{id:string;duplicate:boolean}}>('SELECT lumbung.register_media($1,$2,$3) AS v',
      [JSON.stringify({id,subject_id:subject,purpose,storage_key:`${ctx.tenantId}/${id}`,sha256:file.sha256,mime:file.mime,bytes:file.bytes.length}),key,sha256Hex([hash,file.sha256,file.mime,file.bytes.length].join('|'))])).rows[0].v);
    if(result.id!==id)await unlink(filename);return result;
  }catch(e){await unlink(filename).catch(()=>undefined);throw e;}
}
export function mediaSignature(id:string,ctx:DbCtx,expires:number){
  return createHmac('sha256',getEnv().SESSION_SECRET).update([id,ctx.tenantId,ctx.userId??ctx.linkId,expires].join('|')).digest('base64url');
}
export function privateMediaUrl(id:string,ctx:DbCtx){const exp=Math.floor(Date.now()/1000)+300;return `/api/media/${id}?expires=${exp}&sig=${mediaSignature(id,ctx,exp)}`;}
export async function loadMedia(ctx:DbCtx,id:string,request:Request){
  const url=new URL(request.url),exp=Number(url.searchParams.get('expires')),sig=url.searchParams.get('sig')??'';
  const want=mediaSignature(id,ctx,exp);const now=Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(exp)||exp<now||exp>now+300||sig.length!==want.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(want)))throw new DomainError({code:'FORBIDDEN'});
  const row=await withTx(ctx,async c=>(await c.query<{v:{storage_key:string;mime:string}}>('SELECT lumbung.read_private_media($1) AS v',[id])).rows[0].v);
  let bytes:Buffer;try{bytes=await readFile(storagePath(ctx.tenantId!,id));}catch{throw new DomainError({code:'NOT_FOUND'});}
  return new Response(new Uint8Array(bytes),{headers:{'content-type':row.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff',
    'content-disposition':`attachment; filename="${id}.${row.mime==='application/pdf'?'pdf':row.mime==='image/png'?'png':'jpg'}"`,'content-security-policy':"default-src 'none'; sandbox"}});
}
