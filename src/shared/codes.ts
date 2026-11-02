/**
 * Stable error and reason codes shared by SQL (`RAISE ... 'LB:<CODE>'`), the HTTP
 * envelope and the UI. Extend by adding entries; never rename an existing code.
 *
 * Unknown `LB:<CODE>` values raised by SQL still map safely (422, not retryable) and
 * may carry an explicit `http` in their DETAIL json — see src/db/errors.ts.
 */

export type HttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503;

export interface ErrorCodeSpec {
  http: HttpStatus;
  retryable: boolean;
}

const spec = (http: HttpStatus, retryable = false): ErrorCodeSpec => ({ http, retryable });

export const ERROR_CODES = {
  // ── Transport / generic ────────────────────────────────────────────────
  BAD_REQUEST: spec(400),
  VALIDATION_FAILED: spec(400),
  IDEMPOTENCY_KEY_REQUIRED: spec(400),
  UNAUTHENTICATED: spec(401),
  FORBIDDEN: spec(403),
  CAPABILITY_REQUIRED: spec(403),
  DEMO_ONLY: spec(403),
  LIVE_FORBIDDEN: spec(403),
  NOT_FOUND: spec(404),
  CONFLICT: spec(409),
  REVISION_CONFLICT: spec(409),
  INVALID_STATE: spec(409),
  INVALID_TRANSITION: spec(409),
  IDEMPOTENCY_PAYLOAD_MISMATCH: spec(409),
  IDEMPOTENCY_IN_PROGRESS: spec(409, true),
  SERIALIZATION_FAILURE: spec(409, true),
  CONSTRAINT_VIOLATION: spec(422),
  POLICY_VIOLATION: spec(422),
  CONTEXT_REQUIRED: spec(500),
  UNKNOWN_CAPABILITY: spec(500),
  APPEND_ONLY: spec(403),
  RESET_FORBIDDEN: spec(403),
  INTERNAL: spec(500),
  DB_UNAVAILABLE: spec(503, true),
  DEPENDENCY_UNAVAILABLE: spec(503, true),

  // ── Agreements (PRD §5) ────────────────────────────────────────────────
  AGREEMENT_EXPIRED: spec(422),
  AGREEMENT_REVOKED: spec(422),
  AGREEMENT_UNVERIFIED: spec(422),
  AGREEMENT_OVERLAP_UNRESOLVED: spec(409),
  /** A supersede resolution would leave the FLO without a valid agreement now (0015). */
  AGREEMENT_RESOLUTION_GAP: spec(409),
  AGREEMENT_EXPIRES_IN_TRANSIT: spec(422),
  AGREEMENT_INVALID_INTERVAL: spec(400),
  NEED_EXPIRED: spec(422),

  // ── Approvals / workflow (PRD §9, §12) ─────────────────────────────────
  OUTREACH_APPROVAL_REQUIRED: spec(422),
  DISPATCH_APPROVAL_REQUIRED: spec(422),
  APPROVAL_STALE: spec(409),
  SELF_APPROVAL_FORBIDDEN: spec(403),
  TRANSPORT_UNCONFIRMED: spec(422),
  OFFER_EXPIRED: spec(409),
  SAFETY_REVIEW_REQUIRED: spec(422),
  SAFETY_POLICY_UNAPPROVED: spec(422),
  CONTACT_CLOSED: spec(422),
  STORAGE_INCOMPATIBLE: spec(422),
  ROUTE_CONFIRMATION_REQUIRED: spec(422),

  // ── Quantities / stock (PRD §7, §11) ───────────────────────────────────
  STOCK_UNAVAILABLE: spec(409),
  CAPACITY_UNKNOWN: spec(422),
  CAPACITY_EXCEEDED: spec(422),
  UNIT_MISMATCH: spec(422),
  CONVERSION_MISSING: spec(422),
  QTY_INCREMENT_VIOLATION: spec(422),
  DISTRIBUTED_EXCEEDS_RECEIPT: spec(422),
  RECEIPT_EXCEEDS_DISPATCHED: spec(422),
  NEGATIVE_BALANCE: spec(409),
  LEDGER_UNBALANCED: spec(422),

  // ── Messaging / side effects (INV10) ───────────────────────────────────
  LIVE_SEND_BLOCKED: spec(403),
  CONVERSATION_PAUSED: spec(409),
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function isKnownErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, code);
}

/** Fallback for codes not in the registry (SQL may raise newer codes). */
export const UNKNOWN_DOMAIN_CODE_SPEC: ErrorCodeSpec = spec(422);

export function errorSpec(code: string): ErrorCodeSpec {
  return isKnownErrorCode(code) ? ERROR_CODES[code] : UNKNOWN_DOMAIN_CODE_SPEC;
}

// ── Eligibility (PRD §6, architecture C "Eligibility") ──────────────────────

export const ELIGIBILITY_STATUSES = ['ELIGIBLE', 'INELIGIBLE', 'NEEDS_REVIEW'] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

/** Permanent rejections: the pair cannot enter an executable plan. */
export const INELIGIBLE_REASON_CODES = [
  'AGREEMENT_EXPIRED',
  'AGREEMENT_REVOKED',
  'DIET_CONFLICT',
  'FOOD_WINDOW_EXCEEDED',
  'STOCK_UNAVAILABLE',
  'CAPACITY_EXCEEDED',
  'RECEIVING_CLOSED',
  'FLO_INACTIVE',
  'CONTACT_UNAUTHORISED',
] as const;

/** Temporary: clarification can make the pair eligible. */
export const NEEDS_REVIEW_REASON_CODES = [
  'AGREEMENT_UNVERIFIED',
  'SAFETY_REVIEW_REQUIRED',
  'CAPACITY_UNKNOWN',
  'LOCATION_UNVERIFIED',
] as const;

/** Eligible but with missing fields to confirm before final approval. */
export const CONDITIONAL_REASON_CODES = ['TRANSPORT_UNCONFIRMED'] as const;

export const ELIGIBILITY_REASON_CODES = [
  ...INELIGIBLE_REASON_CODES,
  ...NEEDS_REVIEW_REASON_CODES,
  ...CONDITIONAL_REASON_CODES,
] as const;
export type EligibilityReasonCode = (typeof ELIGIBILITY_REASON_CODES)[number];

export function eligibilitySeverity(code: EligibilityReasonCode): EligibilityStatus {
  if ((INELIGIBLE_REASON_CODES as readonly string[]).includes(code)) return 'INELIGIBLE';
  if ((NEEDS_REVIEW_REASON_CODES as readonly string[]).includes(code)) return 'NEEDS_REVIEW';
  return 'ELIGIBLE';
}

// ── Planner explanation / data-quality flags (architecture C) ───────────────

export const RANKING_REASON_CODES = [
  'HIGH_NEED',
  'LOW_CATEGORY_COVERAGE',
  'RECENTLY_SERVED',
  'BELOW_MIN_USEFUL',
  'LOW_CONFIDENCE_NEED',
  'LOW_CONFIDENCE_DEMAND',
  'LOW_CONFIDENCE_HISTORY',
] as const;
export type RankingReasonCode = (typeof RANKING_REASON_CODES)[number];

export const DATA_FLAGS = ['NEED_MISSING', 'NEED_STALE', 'DEMAND_UNKNOWN', 'ZERO_DEMAND', 'CONVERSION_MISSING'] as const;
export type DataFlag = (typeof DATA_FLAGS)[number];

// ── Offer decline reasons (INV07: never a reporting/responsiveness penalty) ─

export const DECLINE_REASON_CODES = ['FEE_UNAFFORDABLE', 'TIMING', 'DIET', 'SUITABILITY', 'CAPACITY', 'OTHER'] as const;
export type DeclineReasonCode = (typeof DECLINE_REASON_CODES)[number];

// ── Task kinds (staff exception inbox) ──────────────────────────────────────

export const TASK_KINDS = [
  'APPROVAL_INVALIDATED',
  'AGREEMENT_REVOKED',
  'AGREEMENT_REVOKED_ACTIVE_COMMITMENT',
  'AGREEMENT_EXPIRED_AT_HANDOVER',
  'AGREEMENT_RENEWAL',
  'DELIVERY_DELAY',
  'DUPLICATE_EVIDENCE',
  'DISTRIBUTION_STATUS_UNKNOWN',
  'JOB_TERMINAL_FAILURE',
  'SEND_RECONCILE',
  'OFFER_QUESTION',
  'HUMAN_REQUESTED',
  'INBOUND_TRIAGE',
  'STOCK_DEADLINE',
  'REMATCH_REQUIRED',
  'LOGISTICS_REVIEW',
  'CHANNEL_FAILURE',
  'RECEIPT_DISCREPANCY',
  'QUARANTINE_REVIEW',
  'BATCH_EXPIRED',
  'RECALL',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
