import {handler} from '@/src/http/handler';
import {idParam} from '@/src/application/flo/route-helpers';
import {requestAccess} from '@/src/application/reporting/access';
import {loadMedia,privateMediaUrl} from '@/src/application/reporting/media';
import {withTx} from '@/src/db/tx';
export const GET=handler({auth:'none',route:'/api/media/[id]',notFoundOnForbidden:true},async ctx=>{
  const access=await requestAccess(ctx.request,ctx.correlationId);const id=idParam(ctx.params);
  if(!new URL(ctx.request.url).searchParams.has('sig')){
    await withTx(access.ctx,c=>c.query('SELECT lumbung.read_private_media($1)',[id]));return ctx.ok({url:privateMediaUrl(id,access.ctx)});
  }
  return loadMedia(access.ctx,id,ctx.request);
});
