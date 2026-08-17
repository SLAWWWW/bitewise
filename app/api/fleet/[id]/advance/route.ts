import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase-server';
import { RUN_ADVANCE, type RunStatus } from '@/lib/fleet';
import { requireStaffKey } from '@/lib/staff-auth';

const BodySchema = z.object({ action: z.enum(['advance', 'cancel']).default('advance') });

const TIMESTAMP_FIELD: Partial<Record<RunStatus, string>> = {
  en_route: 'en_route_at',
  picked_up: 'picked_up_at',
  completed: 'completed_at',
};

/**
 * Moves one run to its next state: assigned → en route → picked up → completed.
 *
 * The write is guarded on the status we believe the run is in, so two staff
 * advancing the same run at once can't double-step it — the loser sees a 409.
 * Same pattern as approvals and claims.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireStaffKey(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: run, error: fetchError } = await supabase
    .from('fleet_runs')
    .select('id, status, vehicle_id, listing_id')
    .eq('id', id)
    .single();

  if (fetchError || !run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const current = run.status as RunStatus;
  const next: RunStatus | null = parsed.data.action === 'cancel' ? 'cancelled' : RUN_ADVANCE[current];

  if (!next) {
    return NextResponse.json(
      { success: false, message: `This run is already ${current.replace('_', ' ')}.` },
      { status: 409 }
    );
  }
  if (parsed.data.action === 'cancel' && (current === 'completed' || current === 'cancelled')) {
    return NextResponse.json(
      { success: false, message: `A ${current} run can't be cancelled.` },
      { status: 409 }
    );
  }

  const patch: Record<string, unknown> = { status: next };
  const stampField = TIMESTAMP_FIELD[next];
  if (stampField) patch[stampField] = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('fleet_runs')
    .update(patch)
    .eq('id', id)
    .eq('status', current) // guard: only advance from the state we read
    .select('id, status');

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { success: false, message: 'Someone else just updated this run — reloading.' },
      { status: 409 }
    );
  }

  // Completing a run is the moment the food physically reaches the branch, so
  // that's when the inventory row's received_at becomes true. Until now it was
  // stamped at approval time, which claimed the food had arrived before a
  // vehicle had even been to the donor.
  if (next === 'completed' && run.listing_id) {
    const { error: stampError } = await supabase
      .from('inventory_items')
      .update({ received_at: new Date().toISOString() })
      .eq('listing_id', run.listing_id);
    if (stampError) {
      console.error('[fleet] could not stamp arrival time on inventory:', stampError.message);
    }
  }

  return NextResponse.json({ success: true, status: next });
}
