export type DonorType = 'supermarket' | 'hotel' | 'restaurant' | 'factory' | 'other';
export type DonorStatus = 'pending' | 'verified' | 'suspended';
export type FoodType =
  | 'bread'
  | 'cooked'
  | 'produce'
  | 'canned'
  | 'dairy'
  | 'beverage'
  | 'grain'
  | 'other';
export type StorageType = 'ambient' | 'cold' | 'frozen';
export type ListingStatus =
  | 'pending'
  | 'matched'
  | 'in_transit'
  | 'delivered'
  | 'expired'
  | 'cancelled';
export type InventoryStatus = 'in_stock' | 'reserved' | 'distributed' | 'expired' | 'escalated';
export type ClaimStatus = 'claimed' | 'picked_up' | 'no_show';

export interface Donor {
  id: string;
  name: string;
  type: DonorType;
  lat: number;
  lng: number;
  address: string | null;
  reliability_score: number;
  total_kg_donated: number;
  status: DonorStatus;
  created_at: string;
}

export interface Branch {
  id: string;
  organization_name: string;
  name: string;
  area: string | null;
  lat: number;
  lng: number;
  capacity_kg: number;
  current_load_kg: number;
  has_cold_storage: boolean;
  has_cooking: boolean;
  color: string;
  created_at: string;
}

export interface BranchWithRatio extends Branch {
  ratio: number;
}

export interface FoodListing {
  id: string;
  donor_id: string | null;
  matched_branch_id: string | null;
  item_name: string;
  food_type: FoodType;
  quantity_kg: number;
  storage_type: StorageType;
  expiry_at: string;
  status: ListingStatus;
  matching_score: number | null;
  spoilage_risk_score: number | null;
  matched_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  branch_id: string;
  item_name: string;
  food_type: string;
  quantity: number;
  unit: string;
  storage_type: StorageType;
  received_at: string;
  expiry_at: string;
  status: InventoryStatus;
  created_at: string;
}

export interface InventoryItemWithBranch extends InventoryItem {
  branch: Pick<Branch, 'id' | 'name' | 'area' | 'color' | 'organization_name'>;
}

/** Where a donation physically is, from the recipient's point of view. */
export interface DeliveryProgressView {
  stage: 'scheduled' | 'collecting' | 'in_transit' | 'at_branch';
  label: string;
  detail: string;
  /** True once the food is at the branch and can actually be handed over. */
  collectable: boolean;
  fraction: number;
}

/** An inventory item as `/api/inventory` returns it: the row plus everything a
 *  recipient needs to decide whether to collect it, and where it is right now. */
export interface PublicFoodItem extends InventoryItemWithBranch {
  listing_id?: string | null;
  shelf_life_label: string;
  shelf_life_hours: number;
  urgency: 'expired' | 'critical' | 'urgent' | 'monitor' | 'stable';
  storage_advice: string;
  safety_note: string;
  donated_by: string | null;
  donor_type: string | null;
  listed_at: string;
  delivery: DeliveryProgressView;
  publicly_listed: boolean;
  reserved: boolean;
  escalated: boolean;
  distributed: boolean;
  /** Set only while `reserved` is true — when the claim must be picked up by,
   *  agent-computed at claim time (§7.8). Past this with no pickup, the
   *  reservation releases automatically on the next `/api/inventory` read. */
  pickup_deadline_at?: string | null;
}

/** A recipient's lightweight identity — a name (and optional phone), entered
 *  once and persisted client-side. Not authentication: no password, nothing
 *  to log in with. Exists so a claim isn't fully anonymous and so one
 *  recipient can hold only one active reservation at a time. */
export interface RecipientProfile {
  id: string;
  name: string;
  phone: string | null;
  created_at: string;
}

export interface CreateProfileResponse {
  success: boolean;
  message?: string;
  profile?: RecipientProfile;
}

export interface ClaimResponse {
  success: boolean;
  message?: string;
  /** 'active_claim_exists' means the item is still available to others —
   *  this recipient just can't hold a second reservation right now. */
  reason?: 'active_claim_exists';
  pickup_deadline_at?: string;
  pickup_window_minutes?: number;
  pickup_window_rationale?: string;
}

export interface Claim {
  id: string;
  anonymous_id: string;
  profile_id: string | null;
  inventory_item_id: string;
  status: ClaimStatus;
  claimed_at: string;
  picked_up_at: string | null;
  pickup_deadline_at: string | null;
}

/** A recipient's lifetime impact — a running total on recipient_profiles,
 *  not a sum over claims, since confirmed pickups delete their
 *  inventory_items row (§011). */
export interface RecipientImpactStats {
  id: string;
  name: string;
  total_kg_claimed: number;
  donations_completed_count: number;
  meals_equivalent: number;
  co2_avoided_kg: number;
  sustainability_score: number;
}

export interface ActiveClaimSummary {
  claim_id: string;
  claimed_at: string;
  pickup_deadline_at: string | null;
  item_name: string;
  food_type: string;
  quantity: number;
  unit: string;
  expiry_at: string;
  branch_name: string | null;
  branch_area: string | null;
  listing_id: string | null;
  supply_chain_plan: SupplyChainPlan | null;
}

export interface RecipientDashboardResponse {
  success: boolean;
  message?: string;
  profile: RecipientImpactStats | null;
  active_claims: ActiveClaimSummary[];
}

export interface FairnessSnapshot {
  id: string;
  jain_index: number;
  branch_ratios: Record<string, number>;
  total_food_rescued_kg: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_type: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface FairnessResponse {
  jain_index: number;
  branches: Array<{
    id: string;
    name: string;
    area: string | null;
    color: string;
    lat: number;
    lng: number;
    ratio: number;
    current_load_kg: number;
    capacity_kg: number;
  }>;
  total_rescued_kg: number;
  meals_equivalent: number;
  co2_avoided_kg: number;
  active_deliveries: number;
}

export interface SubmitListingResponse {
  success: boolean;
  message?: string;
  listing_id?: string;
  suggested_branch?: string | null;
  suggested_branch_id?: string | null;
  suggested_branch_color?: string | null;
  suggested_branch_lat?: number | null;
  suggested_branch_lng?: number | null;
  score?: number | null;
  distance_km?: number | null;
  spoilage_risk_score?: number | null;
  /** Present on every response once the safety check ships — including
   *  rejections, where it's the reason `success` is false. */
  food_safety_check?: FoodSafetyCheckResult;
}

export interface ApprovalActionResponse {
  success: boolean;
  message?: string;
  matched_branch?: string;
  jain_index?: number;
  /** Outcome of reserving a vehicle for the collection. Absent on rejections. */
  dispatch?: {
    assigned: boolean;
    reason?: string;
    vehicle_label?: string;
    vehicle_type?: string;
    driver_name?: string;
    is_cross_branch?: boolean;
    home_branch_name?: string;
    /** Distance the borrowed vehicle must travel to reach the serving branch. */
    transfer_km?: number;
  };
}

/** One real function call an agent made, as it happened — the tool's name and
 *  exactly what it returned. Persisted so the decision log can prove the
 *  agent went and fetched its numbers rather than inventing them. */
export interface ToolCallTrace {
  name: string;
  result: Record<string, unknown>;
}

export interface CandidateScore {
  branch_id: string;
  branch_name: string;
  branch_color: string;
  distance_km: number;
  proximity_score: number;
  fairness_score: number;
  spoilage_risk_score: number;
  same_type_expiring_soon: number;
  total_score: number;
  rationale?: string;
  tool_calls?: ToolCallTrace[];
}

export interface ExcludedBranchInfo {
  branch_id: string;
  branch_name: string;
  branch_color: string;
  reason: string;
  current_load_kg: number;
  capacity_kg: number;
}

/** One hop in the planned journey from donor doorstep to someone eating it. */
export type SupplyChainStageKind =
  | 'pickup'
  | 'transport'
  | 'storage'
  | 'listing'
  | 'contingency'
  | 'delivery';

export interface SupplyChainStage {
  kind: SupplyChainStageKind;
  /** Short node label for the flow diagram, e.g. "Woodlands cold room". */
  title: string;
  /** Where this happens, e.g. "Willing Hearts — Woodlands". */
  location: string;
  /** One sentence on what happens and why. */
  detail: string;
  /** Human timing for this hop, e.g. "within 45 min of pickup". */
  timing: string;
  /** Optional caution specific to this hop. */
  risk_note?: string;
}

export interface SupplyChainPlan {
  /** One-line summary of the whole route. */
  headline: string;
  stages: SupplyChainStage[];
  contingency: {
    trigger: string;
    beneficiary_name: string;
    beneficiary_type: string;
    minutes_from_branch: number;
    serves: number;
    rationale: string;
  };
  /** Hours from pickup until the food must be eaten or written off. */
  total_window_hours: number;
  /** False when the deterministic planner produced this (no AI available). */
  generated_by_ai: boolean;
  /** Fleet/storage constraint tools the planner actually called. */
  tool_calls?: ToolCallTrace[];
  generated_at: string;
}

/** Recorded when a donation is routed straight to a partner beneficiary at
 *  approval time (the primary channel) instead of public listing — see
 *  `lib/algorithms/beneficiary-matching.ts`. */
export interface BeneficiaryAllocationDetails {
  beneficiary_key: string;
  beneficiary_name: string;
  beneficiary_type: string;
  daily_quota_kg: number;
  fulfilled_before_kg: number;
  need_score: number;
  proximity_score: number;
}

/** 'bad' auto-rejects at submission — the only AI-driven decision in this
 *  codebase allowed to block a donation outright, rather than just advise. */
export type FoodSafetyVerdict = 'good' | 'warning' | 'bad';

export interface FoodSafetyCheckResult {
  verdict: FoodSafetyVerdict;
  /** 0-100, informational — the categorical verdict above is what drives logic. */
  score: number;
  category_key: string;
  category_label: string;
  perishable: boolean;
  requires_cold_chain: boolean;
  safe_temp_note: string;
  /** Declared shelf life ÷ the safe maximum for the declared storage type. */
  ratio: number;
  reasoning: string;
  used_ai: boolean;
  recommended_storage_type?: StorageType | null;
  recommended_expiry_hours?: number | null;
}

export interface MatchDecisionDetails {
  donor_name: string;
  item_name: string;
  food_type: string;
  quantity_kg: number;
  matched_branch_id: string | null;
  matched_branch: string | null;
  weights: { proximity: number; fairness: number; spoilage: number };
  candidates: CandidateScore[];
  excluded_branches: ExcludedBranchInfo[];
  coordinator_rationale?: string;
  used_ai_agents?: boolean;
  /** Cached so re-opening a decision doesn't spend another Gemini call. */
  supply_chain_plan?: SupplyChainPlan;
  /** Present only when this donation was allocated directly to a partner
   *  beneficiary at approval time rather than listed publicly. */
  beneficiary_allocation?: BeneficiaryAllocationDetails;
  /** The standardized safety check every submission passes through before a
   *  listing is even created (Section 7.7). Always present on listings
   *  created after this check shipped — absent on older rows. */
  food_safety_check?: FoodSafetyCheckResult;
}

export interface Decision {
  id: string;
  created_at: string;
  details: MatchDecisionDetails;
  /** The food_listing this decision was made for; used to request its plan. */
  entity_id: string | null;
}

export interface PendingListing {
  id: string;
  item_name: string;
  food_type: FoodType;
  quantity_kg: number;
  storage_type: StorageType;
  expiry_at: string;
  agreed_to_regulations: boolean;
  created_at: string;
  decision_details: MatchDecisionDetails;
  donor: {
    id: string;
    name: string;
    type: DonorType;
    address: string | null;
    status: DonorStatus;
  } | null;
}

// ───── Command Center donation flow (derived server-side in /api/pipeline) ─────

/** One donation's position in its real end-to-end journey — submission is
 *  never enough on its own, since food_listings.status stops at 'matched'
 *  forever; the rest of the story lives in fleet_runs + inventory_items. */
export type PipelineStage =
  | 'submitted'
  | 'approved'
  | 'collecting'
  | 'in_transit'
  | 'listed'
  | 'claimed'
  | 'closed';

export interface PipelineEntry {
  id: string;
  item_name: string;
  food_type: FoodType;
  quantity_kg: number;
  storage_type: StorageType;
  expiry_at: string;
  agreed_to_regulations: boolean;
  created_at: string;
  status: ListingStatus;
  decision_details: MatchDecisionDetails;
  donor: PendingListing['donor'];
  branch_name: string | null;
  branch_color: string | null;
  stage: PipelineStage;
  stage_label: string;
  run_id: string | null;
  run_status: string | null;
  vehicle_label: string | null;
  driver_name: string | null;
  inventory_status: InventoryStatus | null;
}

export interface PipelineResponse {
  entries: PipelineEntry[];
}

// ───── Storage management (derived server-side in /api/storage) ─────

export interface StorageItemView {
  id: string;
  /** The originating donation, if this item was linked via migration 007 — lets
   *  the row open the item's dedicated detail page. Seed stock has none. */
  listing_id: string | null;
  item_name: string;
  food_type: string;
  quantity: number;
  unit: string;
  status: InventoryStatus;
  expiry_at: string;
  shelf_life_label: string;
  shelf_life_hours: number;
  urgency: 'expired' | 'critical' | 'urgent' | 'monitor' | 'stable';
  publicly_listed: boolean;
  reserved: boolean;
  escalated: boolean;
  distributed: boolean;
  expired: boolean;
  within_escalation_window: boolean;
  /** Counted against this zone, but possibly still on the road. */
  delivery: DeliveryProgressView;
  donated_by: string | null;
  /** Set only while `reserved` is true — see PublicFoodItem. */
  pickup_deadline_at?: string | null;
}

export interface StorageZoneView {
  key: StorageType;
  label: string;
  description: string;
  setpoint_c: number;
  tolerance_c: number;
  temperature_c: number;
  health: 'nominal' | 'drifting' | 'breach';
  capacity_kg: number;
  used_kg: number;
  occupancy_pct: number;
  rack_state: 'space' | 'filling' | 'full' | 'over';
  /** Stock sitting in a zone this branch has no allocation for. */
  unsupported_zone: boolean;
  item_count: number;
  items: StorageItemView[];
}

export interface StorageBranchView {
  branch_id: string;
  branch_name: string;
  area: string | null;
  color: string;
  capacity_kg: number;
  current_load_kg: number;
  has_cold_storage: boolean;
  has_cooking: boolean;
  zones: StorageZoneView[];
  total_items: number;
}

export interface StorageResponse {
  branches: StorageBranchView[];
  summary: {
    branches: number;
    total_items: number;
    racks_full: number;
    zones_out_of_range: number;
    unsupported_placements: number;
    publicly_listed: number;
    reserved: number;
    escalated: number;
    distributed: number;
    /** Not counted in total_items (same reasoning as distributed) — surfaced
     *  on its own so staff see how much expired stock is awaiting recycling. */
    expired: number;
    expired_kg: number;
    /** Stock counted at a branch that hasn't physically arrived yet. */
    in_transit: number;
  };
}

// ───── Fleet (from /api/fleet) ─────

export interface FleetVehicleView {
  id: string;
  branch_id: string;
  label: string;
  type: 'refrigerated' | 'truck' | 'van' | 'bike';
  driver_name: string;
  capacity_kg: number;
  is_offline: boolean;
  status: 'idle' | 'assigned' | 'en_route' | 'picked_up' | 'offline';
  home_branch_name: string;
  current_run: {
    id: string;
    listing_id: string | null;
    serving_branch_id: string;
    serving_branch_name: string;
    is_cross_branch: boolean;
    status: 'assigned' | 'en_route' | 'picked_up';
    quantity_kg: number | null;
    assigned_at: string | null;
    listing?: {
      item_name: string;
      quantity_kg: number;
      food_type: string;
      storage_type: string;
      expiry_at: string;
      donor?: { name: string; address: string | null } | null;
    } | null;
  } | null;
}

export interface FleetCoverage {
  branch_id: string;
  branch_name: string;
  area: string | null;
  color: string;
  total: number;
  idle: number;
  active: number;
  offline: number;
  has_refrigerated_idle: boolean;
  borrowed_in: number;
  lent_out: number;
}

export interface FleetResponse {
  fleet: FleetVehicleView[];
  coverage: FleetCoverage[];
  history: {
    id: string;
    vehicle_id: string;
    status: string;
    serving_branch_id: string;
    quantity_kg: number | null;
    assigned_at: string | null;
    completed_at: string | null;
    listing?: { item_name: string; quantity_kg: number } | null;
  }[];
  error?: string;
  message?: string;
}

// ───── Partner dispatch (from /api/dispatch) ─────

export interface DispatchRun {
  branch_id: string;
  branch_name: string;
  area: string | null;
  color: string;
  item_count: number;
  total_kg: number;
  needs_cold_chain: boolean;
  soonest_expiry_hours: number;
  route_exceeds_shelf_life: boolean;
  /** Set once the scheduled 6pm dispatch has committed this branch's run for
   *  today — null means this is still just a live proposal. */
  dispatched_today_at: string | null;
  assignments: {
    item_id: string;
    item_name: string;
    food_type: string;
    storage_type: string;
    quantity: number;
    unit: string;
    shelf_life_label: string;
    shelf_life_hours: number;
    urgency: string;
    partner_name: string;
    partner_type: string;
    compromised: boolean;
  }[];
  stops: {
    sequence: number;
    name: string;
    type: string;
    serves: number;
    note: string;
    items: number;
    kg: number;
  }[];
  route: {
    legs: { from: string; to: string; distance_km: number; minutes: number }[];
    total_distance_km: number;
    total_minutes: number;
    method: 'exact' | 'heuristic';
    permutations_considered: number;
  };
  suggested_vehicle: {
    label: string;
    type: string;
    driver_name: string;
    capacity_kg: number;
    is_cross_branch: boolean;
    home_branch_name: string;
  } | null;
  fleet_available: boolean;
  no_vehicle_reason: string | null;
}

export interface DispatchResponse {
  runs: DispatchRun[];
  summary: {
    escalation_threshold_hours: number;
    branches_with_dispatch: number;
    total_items: number;
    total_kg: number;
    total_distance_km: number;
    people_reached: number;
    at_risk_runs: number;
  };
}

export interface BeneficiaryQuotaView {
  key: string;
  name: string;
  type: string;
  area: string;
  daily_quota_kg: number;
  fulfilled_today_kg: number;
  quota_pct: number;
  serves: number;
}

export interface BeneficiaryResponse {
  beneficiaries: BeneficiaryQuotaView[];
  /** Jain's Fairness Index across quota fulfilment — the same maths as branch
   *  fairness, applied one layer downstream. */
  fairness_index: number;
  /** False if migration 008 hasn't been run yet — fulfilment always reads as
   *  zero without it, so the page can say so instead of looking just-empty. */
  tracking_available: boolean;
}

/** Response from `POST /api/food-safety/check` — used both for the instant
 *  check on `/donate` and, server-side, as the gate inside `POST /api/listings`. */
export interface FoodSafetyCheckResponse {
  success: boolean;
  message?: string;
  result?: FoodSafetyCheckResult;
}

export const FOOD_TYPES: FoodType[] = [
  'bread',
  'cooked',
  'produce',
  'canned',
  'dairy',
  'beverage',
  'grain',
  'other',
];

/** The drafted personalised impact update for one donor, produced by the
 *  Donor Impact Agent. Matches the shape of SupplyChainPlan so the UI can
 *  follow the same pattern (generated_by_ai flag, optional tool_calls trace). */
export interface DonorImpactMessage {
  message: string;
  generated_by_ai: boolean;
  tool_calls?: ToolCallTrace[];
  generated_at: string;
}
