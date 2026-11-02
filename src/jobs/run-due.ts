import 'server-only';
import { randomUUID } from 'node:crypto';
import { withTx } from '@/src/db/tx';
import type { DbCtx } from '@/src/db/types';
import { sendMock, type MockSend } from '@/src/adapters/messaging/mock';
import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {getEnv} from '@/src/config/env';

export async function runDue(ctx: DbCtx, workerId = `inline-${randomUUID()}`, leaseSeconds = 30) {
  let expired = 0, sent = 0;
  for (let guard = 0; guard < 5; guard++) {
    const work = await withTx(ctx, async c => (await c.query<{ expired: number; processed:number }>('SELECT lumbung.run_direct_due() AS expired,lumbung.run_reporting_due()+lumbung.run_inbound_due()+lumbung.run_inventory_due() AS processed')).rows[0]);
    expired += work.expired;
    if (work.expired+work.processed < 100) break;
  }
  for (let guard = 0; guard < 100; guard++) {
    const message = await withTx(ctx, async c => (await c.query<{ message: MockSend | { skipped: boolean } | null }>(
      'SELECT lumbung.claim_any_outbox($1,$2) AS message', [workerId, leaseSeconds])).rows[0].message);
    if (!message) break;
    if ('skipped' in message) continue;
    const result = await sendMock(message);
    await withTx(ctx, c => c.query('SELECT lumbung.finish_direct_outbox($1::uuid,$2,$3,$4)', [message.id, workerId, result.state, result.providerId]));
    sent++;
  }
  const deleted=await withTx(ctx,async c=>(await c.query<{id:string}>('SELECT id FROM lumbung.media_files WHERE deletion_state=\'DELETED\' AND purged_at IS NULL ORDER BY retention_until,id LIMIT 100')).rows);
  for(const file of deleted){await unlink(path.resolve(getEnv().MEDIA_DIR,ctx.tenantId!,file.id)).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;});await withTx(ctx,c=>c.query('SELECT lumbung.mark_media_purged($1)',[file.id]));}
  return { expired, sent };
}
