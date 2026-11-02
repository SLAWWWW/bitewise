import 'server-only';
import { randomUUID } from 'node:crypto';
import { withTx } from '@/src/db/tx';
import type { DbCtx } from '@/src/db/types';
import { hashToken,isWellFormedToken } from '@/src/security/flo-link';
import { DomainError } from '@/src/db/errors';
import { actorCtx,getActor } from '@/src/security/actor';

export interface LinkAccess { tenant_id:string;id:string;flo_id:string;flo_name:string;subject_type:'DELIVERY'|'ALLOCATION';subject_id:string;contact_id:string;expires_at:string;actions:string[];now:string }
export async function resolveLink(token:string):Promise<LinkAccess>{
  if(!isWellFormedToken(token))throw new DomainError({code:'NOT_FOUND'});
  return withTx({tenantId:null,userId:null,actorKind:'SYSTEM',correlationId:randomUUID()},async c=>(await c.query<{v:LinkAccess}>('SELECT lumbung.resolve_flo_link($1) AS v',[hashToken(token)])).rows[0].v);
}
export function linkCtx(link:LinkAccess,correlationId:string=randomUUID()):DbCtx{return {tenantId:link.tenant_id,userId:null,actorKind:'FLO_LINK',linkId:link.id,correlationId};}
export async function requestAccess(request:Request,correlationId:string){
  const token=request.headers.get('x-flo-token');if(token){const link=await resolveLink(token);return {ctx:linkCtx(link,correlationId),link,actor:null};}
  const actor=await getActor(request,correlationId);if(!actor)throw new DomainError({code:'UNAUTHENTICATED'});
  return {ctx:actorCtx(actor,correlationId),link:null,actor};
}
