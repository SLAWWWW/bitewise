import type { InventoryStatus, MatchDecisionDetails, PipelineEntry, PipelineStage } from '@/lib/types';

/**
 * A donation's real stage lives across three tables, not one:
 * `food_listings.status` never advances past 'matched', so the actual
 * journey has to be derived from the fleet run and inventory row it produced.
 * Shared by `/api/pipeline` (the dashboard feed) and `/api/listings/[id]`
 * (the item detail page) so the two can never disagree about where a
 * donation actually is.
 */
export const INVENTORY_STAGE_LABEL: Partial<Record<InventoryStatus, string>> = {
  reserved: 'Reserved by a recipient',
  distributed: 'Collected by recipient',
  escalated: 'Sent to a partner organisation',
  expired: 'Expired on the shelf',
};

export const RUN_STAGE: Record<string, { stage: PipelineStage; label: string }> = {
  assigned: { stage: 'approved', label: 'Approved — pickup scheduled' },
  en_route: { stage: 'collecting', label: 'Driver collecting from donor' },
  picked_up: { stage: 'in_transit', label: 'In transit to the branch' },
  completed: { stage: 'listed', label: 'At the branch — publicly listed' },
  cancelled: { stage: 'approved', label: 'Approved — no active run' },
};

export interface PipelineListingRow {
  id: string;
  item_name: string;
  food_type: string;
  quantity_kg: number;
  storage_type: string;
  expiry_at: string;
  agreed_to_regulations: boolean;
  created_at: string;
  status: string;
  decision_details: MatchDecisionDetails;
  donor: PipelineEntry['donor'];
}

export interface PipelineRunRow {
  id: string;
  listing_id: string;
  vehicle_id: string;
  status: string;
}

export interface PipelineInvRow {
  listing_id: string;
  status: string;
}

export interface PipelineVehicleRow {
  id: string;
  label: string;
  driver_name: string;
}

export function computePipelineEntry(
  row: PipelineListingRow,
  inv: PipelineInvRow | undefined,
  run: PipelineRunRow | undefined,
  vehicle: PipelineVehicleRow | undefined
): PipelineEntry {
  const details = row.decision_details;

  let stage: PipelineStage;
  let stageLabel: string;

  // A run still in flight (assigned/en_route/picked_up) means the food is
  // physically between the donor and the branch — that always takes priority
  // over inventory status. Otherwise a donation allocated to a partner
  // beneficiary *at approval time* (inventory status flips to 'escalated'
  // immediately, before any collection has happened) would misreport as
  // already "sent to a partner" while it's still sitting at the donor's door.
  const runIsOpen = !!run && run.status !== 'completed' && run.status !== 'cancelled';

  if (row.status === 'cancelled' || row.status === 'expired') {
    stage = 'closed';
    stageLabel = row.status === 'cancelled' ? 'Rejected' : 'Expired before review';
  } else if (row.status === 'pending') {
    stage = 'submitted';
    stageLabel = 'Awaiting approval';
  } else if (runIsOpen) {
    const mapped = RUN_STAGE[run!.status] ?? { stage: 'approved' as const, label: 'Approved' };
    stage = mapped.stage;
    stageLabel = mapped.label;
  } else if (inv && inv.status !== 'in_stock' && INVENTORY_STAGE_LABEL[inv.status as InventoryStatus]) {
    stage = 'claimed';
    stageLabel = INVENTORY_STAGE_LABEL[inv.status as InventoryStatus]!;
  } else if (run) {
    const mapped = RUN_STAGE[run.status] ?? { stage: 'approved' as const, label: 'Approved' };
    stage = mapped.stage;
    stageLabel = mapped.label;
  } else if (inv) {
    stage = 'listed';
    stageLabel = 'At the branch — publicly listed';
  } else {
    stage = 'approved';
    stageLabel = 'Approved — awaiting dispatch';
  }

  return {
    id: row.id,
    item_name: row.item_name,
    food_type: row.food_type as PipelineEntry['food_type'],
    quantity_kg: row.quantity_kg,
    storage_type: row.storage_type as PipelineEntry['storage_type'],
    expiry_at: row.expiry_at,
    agreed_to_regulations: row.agreed_to_regulations,
    created_at: row.created_at,
    status: row.status as PipelineEntry['status'],
    decision_details: details,
    donor: row.donor,
    branch_name: details?.matched_branch ?? null,
    branch_color:
      details?.candidates.find((c) => c.branch_id === details.matched_branch_id)?.branch_color ?? null,
    stage,
    stage_label: stageLabel,
    run_id: run?.id ?? null,
    run_status: run?.status ?? null,
    vehicle_label: vehicle?.label ?? null,
    driver_name: vehicle?.driver_name ?? null,
    inventory_status: (inv?.status as InventoryStatus | undefined) ?? null,
  };
}
