import {handler} from '@/src/http/handler';
import {requestAccess} from '@/src/application/reporting/access';
import {storeUpload} from '@/src/application/reporting/media';
import {isValidIdempotencyKey} from '@/src/http/idempotency';
import {DomainError} from '@/src/db/errors';
import {sha256Hex} from '@/src/lib/hash';
export const POST=handler({auth:'none',route:'/api/uploads'},async ctx=>{
  const access=await requestAccess(ctx.request,ctx.correlationId);const key=ctx.request.headers.get('idempotency-key');
  if(!isValidIdempotencyKey(key))throw new DomainError({code:'IDEMPOTENCY_KEY_REQUIRED'});
  return ctx.ok(await storeUpload(access.ctx,ctx.request,key!,sha256Hex([key,ctx.request.headers.get('x-subject-id'),ctx.request.headers.get('x-upload-purpose')].join('|'))),{status:201});
});
