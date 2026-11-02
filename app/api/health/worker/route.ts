import { handler } from '@/src/http/handler';
import { withTx } from '@/src/db/tx';
export const GET=handler({auth:'none'},async ctx=>{
  const state=await withTx({tenantId:null,userId:null,actorKind:'SYSTEM',correlationId:ctx.correlationId},async c=>(await c.query<{healthy:boolean}>(
    "SELECT EXISTS(SELECT 1 FROM lumbung.worker_heartbeats WHERE last_seen>clock_timestamp()-interval '60 seconds') AS healthy")).rows[0]);
  return ctx.ok({status:state.healthy?'ok':'unavailable'},{status:state.healthy?200:503});
});
