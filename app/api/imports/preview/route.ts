import {z} from 'zod';
import {handler} from '@/src/http/handler';
import {parseCsv} from '@/src/domain/imports/csv';
import {sha256Hex} from '@/src/lib/hash';
import {DomainError} from '@/src/db/errors';
const body=z.object({kind:z.enum(['RECEIPTS','FLOS','DONATIONS']),csv:z.string().min(1).max(2*1024*1024)}).strict();
export const POST=handler({capability:'import.preview',body,idempotent:true,route:'/api/imports/preview'},async ctx=>{
 let rows:Record<string,string>[];try{rows=parseCsv(ctx.body.csv);}catch(e){throw new DomainError({code:'BAD_REQUEST',message:(e as Error).message});}
 return ctx.ok(await ctx.tx(async c=>(await c.query('SELECT lumbung.preview_import($1,$2,$3,$4,$5) AS v',[ctx.body.kind,JSON.stringify(rows),sha256Hex(ctx.body.csv),ctx.idempotencyKey,ctx.requestHash])).rows[0].v));
});
