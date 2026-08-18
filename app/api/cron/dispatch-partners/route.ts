import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { runDispatchSweep } from '@/lib/dispatch-planning';

/**
 * On-demand dispatch trigger — no longer a scheduled job. Dispatch now
 * commits automatically the moment a branch actually has escalated stock and
 * no run already in flight (see runDispatchSweep, called directly from
 * approval and the near-expiry sweep), so nothing waits on this endpoint
 * being hit. Kept as a manually-callable trigger for ops/testing — same
 * underlying logic, just not gated to any fixed time of day.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const results = await runDispatchSweep(supabase);

  return NextResponse.json({ results });
}
