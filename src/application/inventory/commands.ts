import 'server-only';
import type {Queryable} from '@/src/db/types';
import type {Idempotency,CommandResult} from '@/src/application/direct/commands';
import {planAllocation,type FeatureSnapshot} from '@/src/domain/allocation/planner';
import type {z} from 'zod';
import type {releaseBody} from '@/src/contracts/inventory';
export async function inventoryCommand(c:Queryable,action:string,id:string|null,body:unknown,idem:Idempotency){
 return (await c.query<{v:CommandResult}>('SELECT lumbung.inventory_command($1,$2,$3,$4,$5) AS v',[action,id,JSON.stringify(body),idem.idempotencyKey,idem.requestHash])).rows[0].v;
}
export async function planRelease(c:Queryable,body:z.infer<typeof releaseBody>,idem:Idempotency){
 const rp=(await c.query<{v:{id:string}}>('SELECT lumbung.create_release_plan($1,$2,$3) AS v',[JSON.stringify(body),idem.idempotencyKey,idem.requestHash])).rows[0].v;
 const snapshot=(await c.query<{v:FeatureSnapshot}>('SELECT lumbung.inventory_features($1,$2,$3) AS v',[rp.id,body.receipt_at,body.distribution_at])).rows[0].v;
 const result=planAllocation(snapshot);
 return (await c.query<{v:{id:string;release_plan_id:string}}>('SELECT lumbung.save_inventory_run($1,$2,$3,$4,$5) AS v',[rp.id,JSON.stringify(snapshot),JSON.stringify(result),`${idem.idempotencyKey}:run`,idem.requestHash])).rows[0].v;
}
