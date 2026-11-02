import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { getEnv, assertModeAtStartup } from '@/src/config/env';
import { withTx } from '@/src/db/tx';
import { closePool } from '@/src/db/pool';
import { entityId, tenantNamespace, isUuid } from '@/src/lib/uuidv5';
import { runDue } from './run-due';

loadEnvConfig(process.cwd());
assertModeAtStartup();
const env = getEnv();
const tenantId = process.env.WORKER_TENANT_ID ?? (env.APP_MODE === 'LIVE' ? '' : entityId(tenantNamespace('foodcycle-demo'), 'tenant', 'foodcycle-demo'));
if (!isUuid(tenantId)) throw new Error('Set WORKER_TENANT_ID to an authorised tenant UUID');
const workerId = env.WORKER_ID ?? `worker-${randomUUID()}`;
const ctx = { tenantId, userId: null, actorKind: 'WORKER' as const, correlationId: workerId };
let stop = false;
process.once('SIGINT', () => { stop = true; });
process.once('SIGTERM', () => { stop = true; });
async function main() {
  console.info(`[worker] ${workerId}: tenant ${tenantId}`);
  try {
    do {
      try {
        await runDue(ctx, workerId, env.LEASE_SECONDS);
        await withTx(ctx, c => c.query('SELECT lumbung.direct_worker_heartbeat($1)', [workerId]));
      } catch (e) { console.error('[worker] tick failed', e instanceof Error ? e.message : 'UNKNOWN'); }
      if (process.argv.includes('--once')) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (!stop);
  } finally { await closePool(); }
}
void main().catch(() => { process.exitCode = 1; });
