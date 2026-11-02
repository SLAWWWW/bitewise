import 'server-only';
import type { Queryable } from '@/src/db/types';
import { planAllocation, type FeatureSnapshot, type Plan } from '@/src/domain/allocation/planner';

export interface CommandResult { id: string; state: string; revision: number; delivery_id?: string; receipt_id?: string; inspection_id?: string }
export interface Idempotency { idempotencyKey: string; requestHash: string }
export async function directCommand(c: Queryable, action: string, subject: string | null, body: unknown, idem: Idempotency): Promise<CommandResult> {
  const r = await c.query<{ result: CommandResult }>('SELECT lumbung.workflow_command($1,$2::uuid,$3::jsonb,$4,$5) AS result',
    [action, subject, JSON.stringify(body), idem.idempotencyKey, idem.requestHash]);
  return r.rows[0].result;
}
export async function runAllocation(c: Queryable, body: { item_id: string; receipt_at: string; distribution_at: string }, idem: Idempotency) {
  const r = await c.query<{ snapshot: FeatureSnapshot }>('SELECT lumbung.direct_features($1::uuid,$2::timestamptz,$3::timestamptz) AS snapshot',
    [body.item_id, body.receipt_at, body.distribution_at]);
  const snapshot = r.rows[0].snapshot;
  const plan = planAllocation(snapshot);
  const saved = await c.query<{ result: { id: string; item_id: string; result: Plan } }>('SELECT lumbung.save_direct_run($1::uuid,$2::jsonb,$3::jsonb,$4,$5) AS result',
    [body.item_id, JSON.stringify(snapshot), JSON.stringify(plan), idem.idempotencyKey, idem.requestHash]);
  return saved.rows[0].result;
}
