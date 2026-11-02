/**
 * State and category enums (PRD §12, architecture A.1). These must stay identical to
 * the SQL `CHECK (x IN (...))` lists in db/migrations.
 */

export const TENANT_MODES = ['DEMO', 'TEST', 'LIVE'] as const;
export type TenantMode = (typeof TENANT_MODES)[number];

export const CLOCK_MODES = ['FROZEN', 'TICKING', 'REAL'] as const;
export type ClockMode = (typeof CLOCK_MODES)[number];

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ROUTES = ['DIRECT', 'WAREHOUSE_INBOUND'] as const;
export type DonationRoute = (typeof ROUTES)[number];

export const DONATION_STATES = [
  'DRAFT',
  'NEEDS_INFO',
  'SAFETY_REVIEW',
  'READY',
  'ALLOCATING',
  'PARTIALLY_ALLOCATED',
  'FULLY_ALLOCATED',
  'CLOSED',
  'CANCELLED',
] as const;
export type DonationState = (typeof DONATION_STATES)[number];

export const DONATION_REASONS = [
  'SURPLUS',
  'NEAR_EXPIRY',
  'COSMETIC_PRODUCE',
  'OUTER_PACKAGING_DAMAGE',
  'PRODUCTION_EXCESS',
  'OTHER',
] as const;

export const SAFETY_STATES = ['PENDING', 'CLEARED', 'REVIEW_REQUIRED', 'REJECTED'] as const;
export type SafetyState = (typeof SAFETY_STATES)[number];

export const CAMPAIGN_STATES = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export const OFFER_STATES = [
  'DRAFT',
  'HELD',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'ACCEPTED',
  'PARTIALLY_ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'SEND_FAILED',
  'DELIVERY_UNKNOWN',
] as const;
export type OfferState = (typeof OFFER_STATES)[number];

export const ALLOCATION_STATES = [
  'PROPOSED',
  'OFFER_HELD',
  'ACCEPTED_RESERVED',
  'LOGISTICS_PENDING',
  'AWAITING_FINAL_APPROVAL',
  'APPROVED',
  'DISPATCHED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
  'EXPIRED',
  'EXCEPTION',
] as const;
export type AllocationState = (typeof ALLOCATION_STATES)[number];

export const DELIVERY_STATES = [
  'PLANNED',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'RECEIVED',
  'PARTIALLY_RECEIVED',
  'FAILED',
  'RETURN_PENDING',
  'RESOLVED_EXCEPTION',
  'CANCELLED',
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const OBLIGATION_TYPES = ['BAST', 'RECEIPT_PHOTO', 'DISTRIBUTION'] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

export const OBLIGATION_STATES = [
  'OPEN',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_CLARIFICATION',
  'ACCEPTED',
  'REJECTED_FINAL',
  'EXCUSED',
] as const;
export type ObligationState = (typeof OBLIGATION_STATES)[number];

export const TIMELINESS = ['NOT_DUE', 'ON_TIME', 'LATE', 'MISSING'] as const;
export type Timeliness = (typeof TIMELINESS)[number];

export const BATCH_STATES = [
  'AVAILABLE',
  'PARTIALLY_RESERVED',
  'FULLY_RESERVED',
  'QUARANTINED',
  'RECALL_HOLD',
  'EXPIRED',
  'DEPLETED',
] as const;
export type BatchState = (typeof BATCH_STATES)[number];

export const STOCK_ACCOUNTS = [
  'AVAILABLE',
  'RESERVED',
  'IN_TRANSIT',
  'QUARANTINE',
  'RETURN_PENDING',
  'DISPOSED',
  'EXTERNAL_RECEIPT',
  'DELIVERED',
  'EXCEPTION',
  'ADJUSTMENT_OFFSET',
] as const;
export type StockAccount = (typeof STOCK_ACCOUNTS)[number];

/** Stored review state. The lifecycle state is derived (see AGREEMENT_LIFECYCLE). */
export const AGREEMENT_REVIEW_STATES = [
  'PENDING_VERIFICATION',
  'APPROVED',
  'REJECTED',
  'REVOKED',
  'SUPERSEDED',
] as const;
export type AgreementReviewState = (typeof AGREEMENT_REVIEW_STATES)[number];

/** Derived lifecycle state (PRD §5). EXPIRING_SOON is a badge on ACTIVE, not a state. */
export const AGREEMENT_LIFECYCLE = [
  'PENDING_VERIFICATION',
  'SCHEDULED',
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
  'SUPERSEDED',
  'REJECTED',
] as const;
export type AgreementLifecycle = (typeof AGREEMENT_LIFECYCLE)[number];

export const RESERVATION_KINDS = ['HOLD', 'RESERVATION'] as const;
export const RESERVATION_STATES = ['ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED'] as const;

export const TRANSPORT_METHODS = ['SELF_PICKUP', 'FLO_BOOKED_COURIER', 'FOODCYCLE_COORDINATED_COURIER'] as const;
export type TransportMethod = (typeof TRANSPORT_METHODS)[number];

export const QUOTE_STATUSES = ['NOT_APPLICABLE', 'AWAITING_QUOTE', 'QUOTED', 'CONFIRMED', 'REFUSED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const APPROVAL_STAGES = [
  'OUTREACH',
  'FINAL_DISPATCH',
  'MANUAL_ALLOCATION',
  'ADJUSTMENT',
  'QUARANTINE_RELEASE',
  'RECEIPT_CORRECTION',
  'POLICY',
] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

export const POLICY_KINDS = ['ALLOCATION', 'SAFETY', 'REPORTING', 'LOGISTICS', 'OUTREACH', 'RETENTION'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

export const POLICY_STATUSES = ['DRAFT', 'APPROVED_DEMO', 'APPROVED_LIVE', 'RETIRED'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const FLO_TYPES = ['PANTI', 'NON_PANTI'] as const;
export type FloType = (typeof FLO_TYPES)[number];

export const FLO_STATUSES = ['ACTIVE', 'PAUSED'] as const;

export const AREAS = ['JAKARTA', 'BOGOR', 'DEPOK', 'TANGERANG', 'BEKASI'] as const;
export type Area = (typeof AREAS)[number];

export const LOCATION_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED'] as const;

export const CATEGORY_CODES = ['BREAD', 'PREPARED_MEAL', 'PRODUCE', 'RICE', 'SNACK', 'STAPLE'] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

export const UNIT_KINDS = ['COUNT', 'MASS', 'VOLUME'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const STORAGE_PROFILES = ['AMBIENT', 'CHILLED', 'FROZEN'] as const;

export const CONTACT_CHANNELS = ['SIM', 'WHATSAPP', 'EMAIL'] as const;

export const TASK_STATES = ['OPEN', 'CLAIMED', 'DONE', 'CANCELLED'] as const;

export const JOB_STATES = ['QUEUED', 'RUNNING', 'RETRY', 'DONE', 'DEAD'] as const;

export const OUTBOX_STATES = [
  'PENDING',
  'HELD_TAKEOVER',
  'SENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'DELIVERY_UNKNOWN',
  'CANCELLED',
] as const;

export const MESSAGE_INTENTS = [
  'OFFER_DONATION',
  'CLARIFY_ITEM',
  'ACCEPT_OFFER',
  'PARTIAL_ACCEPT',
  'DECLINE_OFFER',
  'CONFIRM_TRANSPORT',
  'CONFIRM_RECEIPT',
  'SUBMIT_BAST',
  'SUBMIT_RECEIPT_PHOTO',
  'REPORT_DISTRIBUTION',
  'SUBMIT_DISTRIBUTION_PHOTO',
  'UPDATE_AVAILABILITY',
  'REQUEST_FOOD',
  'REQUEST_HUMAN',
  'UNKNOWN',
] as const;
export type MessageIntent = (typeof MESSAGE_INTENTS)[number];

/** Activation decisions (PRD §27). Must match the CHECK list in db/migrations/0002. */
export const ACTIVATION_DECISION_KEYS = [
  'REGISTRY_SOURCE_OF_TRUTH',
  'WAREHOUSE_STOCK_CONTRACT',
  'EVIDENCE_DEADLINE_POLICY',
  'SAFETY_PROFILES',
  'NEED_SCORING',
  'COURIER_FEE_PROCESS',
  'CONTACT_PERMISSIONS',
  'MEDIA_POLICY',
  'APPROVAL_ROLES',
  'HOSTING_OPERATIONS',
] as const;
export type ActivationDecisionKey = (typeof ACTIVATION_DECISION_KEYS)[number];

/** tasks.severity CHECK (db/migrations/0002). */
export const TASK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TaskSeverity = (typeof TASK_SEVERITIES)[number];

/** ISO day of week used by availability / contact-hour rows: Monday = 1 … Sunday = 7. */
export const ISO_DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoDayOfWeek = (typeof ISO_DAYS_OF_WEEK)[number];

/** Evidence due-date rules (src/domain/reporting/deadlines.ts). */
export const DUE_RULES = ['CALENDAR_NEXT_DAY_EOD', 'ROLLING_24H', 'AT_RECEIPT'] as const;
export type DueRule = (typeof DUE_RULES)[number];

/** Service-schedule count bases (src/domain/flo/schedule.ts); never summed across bases. */
export const COUNT_BASES = ['DAILY_RESIDENTS', 'PER_EVENT', 'WEEKLY_REACH'] as const;
export type CountBasis = (typeof COUNT_BASES)[number];

/** Category-demand bases (src/domain/flo/demand.ts). */
export const DEMAND_BASES = ['PER_EVENT_QTY', 'PER_PERSON_QTY'] as const;
export type DemandBasis = (typeof DEMAND_BASES)[number];
