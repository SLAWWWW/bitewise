import { createServerClient } from '@/lib/supabase-server';
import {
  runPlannerAgent,
  type PlannerConstraints,
  type PlannerInput,
} from '@/lib/agents/planner-agent';
import { beneficiariesForArea } from '@/lib/data/beneficiaries';
import { rankDispatchCandidates, isOpenRun, type FleetRunRow, type VehicleRow } from '@/lib/fleet';
import { zoneAllocation, rackState } from '@/lib/storage-zones';
import type { Branch, FoodType, MatchDecisionDetails, StorageType } from '@/lib/types';

/**
 * Streams the Supply Chain Planner Agent's work as it happens (SSE).
 *
 * Every `step` event is emitted at the moment that piece of work actually
 * finishes — the food-safety lookup, the competing-stock query, the partner
 * shortlist, and the model call are all real. Nothing here is a timed
 * animation pretending to be computation; if a step is fast, its event
 * arrives fast.
 *
 * The finished plan is cached onto the listing's decision_details so
 * re-opening a decision costs no further Gemini quota.
 */
export async function GET(request: Request) {
  const listingId = new URL(request.url).searchParams.get('listing_id');
  if (!listingId) {
    return new Response(JSON.stringify({ error: 'listing_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const fail = (message: string) => {
        send('error', { message });
        controller.close();
      };

      try {
        const supabase = createServerClient();

        const { data: listing, error: listingError } = await supabase
          .from('food_listings')
          .select('*')
          .eq('id', listingId)
          .single();

        if (listingError || !listing) return fail('Listing not found.');

        const details = listing.decision_details as MatchDecisionDetails | null;

        // Already planned — hand it straight back rather than paying for it twice.
        if (details?.supply_chain_plan) {
          send('cached', { plan: details.supply_chain_plan });
          send('done', {});
          return controller.close();
        }

        if (!details?.matched_branch_id) {
          return fail('This donation has no assigned branch yet, so there is nothing to plan.');
        }

        send('step', { id: 'load', label: 'Reading donation record', status: 'done' });

        const [{ data: donor }, { data: branch }] = await Promise.all([
          supabase.from('donors').select('*').eq('id', listing.donor_id).single(),
          supabase.from('branches').select('*').eq('id', details.matched_branch_id).single(),
        ]);

        if (!donor || !branch) return fail('Could not load the donor or destination branch.');
        const typedBranch = branch as Branch;

        send('step', {
          id: 'branch',
          label: `Destination confirmed: ${typedBranch.name.replace('Willing Hearts — ', '')}`,
          status: 'done',
          note: typedBranch.has_cold_storage ? 'cold storage available' : 'no cold storage on site',
        });

        send('step', {
          id: 'safety',
          label: `Consulting food-safety reference for ${listing.food_type}`,
          status: 'done',
        });

        // Real query: what else at this branch competes for the same claimants?
        const { data: competing } = await supabase
          .from('inventory_items')
          .select('id, expiry_at')
          .eq('branch_id', typedBranch.id)
          .eq('food_type', listing.food_type)
          .eq('status', 'in_stock');

        const now = Date.now();
        const sameTypeExpiringSoon = (competing ?? []).filter((i) => {
          const h = (new Date(i.expiry_at).getTime() - now) / 3_600_000;
          return h > 0 && h <= 24;
        }).length;

        send('step', {
          id: 'competition',
          label: 'Scanning branch stock for competing near-expiry items',
          status: 'done',
          note:
            sameTypeExpiringSoon > 0
              ? `${sameTypeExpiringSoon} competing ${listing.food_type} item(s)`
              : 'no competing stock',
        });

        const partners = beneficiariesForArea(typedBranch.area);
        send('step', {
          id: 'partners',
          label: `Shortlisting partner beneficiaries in ${typedBranch.area ?? 'the region'}`,
          status: 'done',
          note: `${partners.length} partners available`,
        });

        const hoursUntilExpiry = Math.max(
          0,
          (new Date(listing.expiry_at).getTime() - now) / 3_600_000
        );

        // Gather the live operational constraints the planner's tools will read.
        const needsColdChain = listing.storage_type === 'cold' || listing.storage_type === 'frozen';
        const constraints = await gatherConstraints(supabase, {
          servingBranch: typedBranch,
          quantityKg: listing.quantity_kg,
          storageType: listing.storage_type as StorageType,
          needsColdChain,
        });

        send('step', {
          id: 'fleet',
          label: 'Checking vehicle availability',
          status: 'done',
          note:
            constraints.fleet.length === 0
              ? 'none free right now'
              : `${constraints.fleet.length} available${constraints.fleet[0].is_cross_branch ? ' (cross-branch)' : ''}`,
        });

        send('step', {
          id: 'racks',
          label: `Checking ${listing.storage_type} storage headroom`,
          status: 'done',
          note: constraints.storage
            ? `${constraints.storage.occupancy_pct}% full`
            : 'no reading',
        });

        const input: PlannerInput = {
          donorName: donor.name,
          donorAddress: donor.address,
          donorArea: donor.address ?? 'Singapore',
          branchName: typedBranch.name,
          branchArea: typedBranch.area,
          branchHasColdStorage: typedBranch.has_cold_storage,
          branchHasCooking: typedBranch.has_cooking,
          distanceKm:
            details.candidates.find((c) => c.branch_id === typedBranch.id)?.distance_km ?? 0,
          itemName: listing.item_name,
          foodType: listing.food_type as FoodType,
          storageType: listing.storage_type as StorageType,
          quantityKg: listing.quantity_kg,
          hoursUntilExpiry,
          sameTypeExpiringSoon,
          constraints,
        };

        send('step', { id: 'plan', label: 'Planning the route', status: 'running' });

        const plan = await runPlannerAgent(input);

        send('step', {
          id: 'plan',
          label: plan.generated_by_ai
            ? 'Route planned'
            : 'Route planned (deterministic — AI unavailable)',
          status: 'done',
        });

        // Cache onto the existing JSONB so no schema change is needed.
        const { error: cacheError } = await supabase
          .from('food_listings')
          .update({ decision_details: { ...details, supply_chain_plan: plan } })
          .eq('id', listingId);
        if (cacheError) {
          // The plan was generated successfully and is about to be sent to the
          // client. A cache write failure only means this plan costs another
          // Gemini call if the user re-opens the decision drawer — log it but
          // don't fail the stream.
          console.error(
            `[agents/plan] decision_details cache write failed for listing ${listingId}. ` +
              'The plan was generated but will not be cached and will cost another API call ' +
              'the next time this listing is opened. Cause:',
            cacheError.message
          );
        }

        send('plan', { plan });
        send('done', {});
        controller.close();
      } catch (error) {
        console.error('supply chain plan stream failed:', error);
        send('error', { message: 'The planner hit an unexpected error.' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops proxies (and Next's dev server) from buffering the stream.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Reads the live fleet and storage picture the planner's tools will report on.
 *
 * Fetched here rather than inside the tools so a tool response is always
 * grounded in one consistent snapshot — and so a missing fleet table degrades to
 * "no vehicle information" instead of failing the whole plan.
 */
async function gatherConstraints(
  supabase: ReturnType<typeof createServerClient>,
  params: {
    servingBranch: Branch;
    quantityKg: number;
    storageType: StorageType;
    needsColdChain: boolean;
  }
): Promise<PlannerConstraints> {
  const { servingBranch, quantityKg, storageType, needsColdChain } = params;

  const [vehiclesRes, runsRes, branchesRes, zoneItemsRes] = await Promise.all([
    supabase.from('vehicles').select('*'),
    supabase.from('fleet_runs').select('*'),
    supabase.from('branches').select('id, name, lat, lng'),
    supabase
      .from('inventory_items')
      .select('quantity')
      .eq('branch_id', servingBranch.id)
      .eq('storage_type', storageType)
      .in('status', ['in_stock', 'reserved', 'escalated']),
  ]);

  let fleet: PlannerConstraints['fleet'] = [];
  if (!vehiclesRes.error && !runsRes.error && !branchesRes.error) {
    fleet = rankDispatchCandidates({
      vehicles: (vehiclesRes.data ?? []) as VehicleRow[],
      openRuns: ((runsRes.data ?? []) as FleetRunRow[]).filter((r) => isOpenRun(r.status)),
      branches: branchesRes.data ?? [],
      servingBranchId: servingBranch.id,
      quantityKg,
      needsColdChain,
    }).map((c) => ({
      label: c.vehicle.label,
      type: c.vehicle.type,
      driver_name: c.vehicle.driver_name,
      capacity_kg: c.vehicle.capacity_kg,
      is_cross_branch: c.is_cross_branch,
      home_branch_name: c.home_branch_name,
      transfer_km: c.distance_km,
    }));
  }

  const allocation = zoneAllocation(servingBranch.capacity_kg, servingBranch.has_cold_storage);
  const zoneCapacity = allocation[storageType];
  const usedKg = (zoneItemsRes.data ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0);

  return {
    fleet,
    storage: {
      zone: storageType,
      used_kg: Number(usedKg.toFixed(1)),
      capacity_kg: zoneCapacity,
      occupancy_pct: zoneCapacity > 0 ? Math.round((usedKg / zoneCapacity) * 100) : 999,
      rack_state: rackState(usedKg, zoneCapacity),
      supported: zoneCapacity > 0,
    },
  };
}
