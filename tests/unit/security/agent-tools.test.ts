import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {runBoundedTools,toolInputs,type ToolCall} from '@/src/agents/contracts';
it('strict tool inputs reject model supplied tenant, permissions and approval instructions',()=>{
 expect(Object.keys(toolInputs)).toHaveLength(11);expect(toolInputs.get_order_context.safeParse({order_id:randomUUID(),tenant_id:randomUUID(),capabilities:['dispatch.approve']}).success).toBe(false);
});
it('bounds calls, deduplicates retries, and hands unavailable dependencies to staff',async()=>{
 const execute=vi.fn(async()=>({status:'OK' as const,data:{read:true}}));const call:ToolCall={name:'get_order_context',input:{order_id:randomUUID()},idempotencyKey:randomUUID()};const result=await runBoundedTools(Array(20).fill(call),execute);expect(execute).toHaveBeenCalledTimes(1);expect(result.results).toHaveLength(8);expect(result.handoff).toBe('BUDGET_EXHAUSTED');
 expect((await runBoundedTools([call],async()=>{throw Error('offline');})).handoff).toBe('MANUAL_FALLBACK');
});
