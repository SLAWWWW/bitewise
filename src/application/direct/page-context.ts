import 'server-only';
import { redirect } from 'next/navigation';
import { actorCtx, getServerActor } from '@/src/security/actor';
import { getLocale } from '@/src/i18n/server';
import { makeT } from '@/src/i18n';
import { withTx } from '@/src/db/tx';
import type { TxClient } from '@/src/db/types';
import { DomainError } from '@/src/db/errors';

export async function directPage() {
  const actor=await getServerActor(); if(!actor)redirect('/masuk');
  if(!actor.capabilities.includes('flo.read'))throw new DomainError({code:'CAPABILITY_REQUIRED',message:'flo.read is required'});
  const locale=await getLocale();
  return { actor,locale,t:makeT('direct',locale),can:(cap:string)=>actor.capabilities.some(c=>c===cap),
    tx:<T>(fn:(c:TxClient)=>Promise<T>)=>withTx(actorCtx(actor),fn) };
}
