import {z} from 'zod';
import {positiveQtyString,qtyString} from '@/src/lib/qty';
const revision=z.number().int().positive();const uuid=z.uuid();const instant=z.iso.datetime({offset:true});
/** Tenant, capability, reviewer and clock inputs are deliberately absent. */
export const toolInputs={
 get_order_context:z.object({order_id:uuid}).strict(),
 evaluate_eligibility:z.object({item_id:uuid,flo_id:uuid,quantity:positiveQtyString,receipt_at:instant,distribution_at:instant}).strict(),
 rank_candidates:z.object({item_id:uuid,item_revision:revision,policy_id:uuid,receipt_at:instant,distribution_at:instant}).strict(),
 draft_campaign:z.object({run_id:uuid,reason:z.string().min(3).max(1000)}).strict(),
 queue_approved_offer:z.object({campaign_id:uuid,expected_revision:revision}).strict(),
 record_offer_response:z.object({offer_id:uuid,expected_revision:revision,message_event_id:uuid,response:z.enum(['ACCEPT','PARTIAL_ACCEPT','DECLINE']),quantity:qtyString.optional(),reason:z.string().max(300).optional()}).strict(),
 propose_transport_update:z.object({allocation_id:uuid,expected_revision:revision,method:z.enum(['SELF_PICKUP','FLO_BOOKED_COURIER','FOODCYCLE_COORDINATED_COURIER']),fee_idr:z.number().int().nonnegative().nullable(),note:z.string().min(3).max(1000)}).strict(),
 propose_inventory_release:z.object({warehouse_id:uuid,batch_ids:z.array(uuid).min(1).max(100),quantity:positiveQtyString}).strict(),
 submit_evidence:z.object({delivery_id:uuid,obligation_id:uuid,expected_revision:revision,media_ids:z.array(uuid).max(12),note:z.string().max(6000)}).strict(),
 request_clarification:z.object({conversation_id:uuid,text:z.string().min(1).max(1000),purpose:z.enum(['OFFER','REPORTING','ASSISTANCE']),deduplication_key:z.string().min(8).max(200)}).strict(),
 create_human_task:z.object({subject_type:z.enum(['DONATION','ALLOCATION','DELIVERY','OBLIGATION','CONVERSATION','BATCH']),subject_id:uuid,reason:z.string().min(3).max(1000),priority:z.enum(['MEDIUM','HIGH','CRITICAL'])}).strict(),
} as const;
export type ToolName=keyof typeof toolInputs;
export type ToolResult={status:'OK';data:unknown}|{status:'CONFLICT'|'POLICY_REJECTED';code:string};
export interface ToolCall {name:ToolName;input:unknown;idempotencyKey:string}
/** Executor is injected by a server coordinator bound to an authenticated scope.
 * A provider response can only request these effects; it never supplies authority.
 * Bounded calls and time stop recursive or unavailable model workflows. */
export async function runBoundedTools(calls:readonly ToolCall[],execute:(name:ToolName,input:unknown,key:string,signal:AbortSignal)=>Promise<ToolResult>,options:{budget?:number;timeoutMs?:number}={}){
 const budget=Math.min(8,Math.max(0,options.budget??8));const deadline=AbortSignal.timeout(Math.min(10000,Math.max(1,options.timeoutMs??5000)));const results:ToolResult[]=[];
 const intents=new Map<string,{signature:string;result:ToolResult}>();
 for(const call of calls){if(results.length>=budget||deadline.aborted)return {results,handoff:'BUDGET_EXHAUSTED' as const};
  const schema=Object.hasOwn(toolInputs,call.name)?toolInputs[call.name]:null;const parsed=schema?.safeParse(call.input);if(!parsed?.success){results.push({status:'POLICY_REJECTED',code:'TOOL_INPUT_INVALID'});continue;}
  const signature=JSON.stringify([call.name,parsed.data]);const prior=intents.get(call.idempotencyKey);if(prior){results.push(prior.signature===signature?prior.result:{status:'CONFLICT',code:'IDEMPOTENCY_PAYLOAD_MISMATCH'});continue;}
  try{let remove=()=>{};const timedOut=new Promise<never>((_,reject)=>{const abort=()=>reject(new Error('TOOL_TIMEOUT'));if(deadline.aborted)abort();else{deadline.addEventListener('abort',abort,{once:true});remove=()=>deadline.removeEventListener('abort',abort);}});
   let result:ToolResult;try{result=await Promise.race([execute(call.name,parsed.data,call.idempotencyKey,deadline),timedOut]);}finally{remove();}
   results.push(result);intents.set(call.idempotencyKey,{signature,result});}
  catch{results.push({status:'POLICY_REJECTED',code:'DEPENDENCY_UNAVAILABLE'});return {results,handoff:'MANUAL_FALLBACK' as const};}
 }
 return {results,handoff:null};
}
