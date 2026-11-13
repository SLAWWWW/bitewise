import 'server-only';
import type { Queryable } from '@/src/db/types';

export interface VolunteerCommandResult {
  id: string;
  delivery_id?: string;
  state?: string;
  revision: number;
}

export async function volunteerCommand(
  c: Queryable,
  action: string,
  subject: string,
  body: unknown,
  idem: { idempotencyKey: string; requestHash: string },
): Promise<VolunteerCommandResult> {
  const row = await c.query<{ result: VolunteerCommandResult }>(
    'SELECT lumbung.volunteer_command($1,$2::uuid,$3::jsonb,$4,$5) AS result',
    [action, subject, JSON.stringify(body), idem.idempotencyKey, idem.requestHash],
  );
  return row.rows[0].result;
}
