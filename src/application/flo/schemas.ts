/**
 * Request/filter schemas for the FLO vertical (W2-FLO). Shared by the route handlers
 * (app/api/flos/**) and the server pages (app/(ops)/flo/**), so the directory URL
 * (?area=&cluster=…) and GET /api/flos accept exactly the same filters.
 */
import { z } from 'zod';
import { QTY_PATTERN } from '@/src/lib/qty';

export const AREAS = ['JAKARTA', 'BOGOR', 'DEPOK', 'TANGERANG', 'BEKASI'] as const;
export type Area = (typeof AREAS)[number];

export const FLO_TYPES = ['PANTI', 'NON_PANTI'] as const;
export type FloType = (typeof FLO_TYPES)[number];

export const FLO_STATUSES = ['ACTIVE', 'PAUSED'] as const;
export const LOCATION_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED'] as const;
export const STORAGE_PROFILES = ['AMBIENT', 'CHILLED', 'FROZEN'] as const;

/**
 * Directory-level agreement status, derived at the tenant clock (never stored):
 *  ACTIVE / EXPIRING_SOON  an APPROVED agreement is valid now (≤ 30 days left = EXPIRING_SOON)
 *  SCHEDULED               none valid now, but an approved one starts later
 *  REVOKED                 the latest decided agreement that has started was revoked
 *  EXPIRED                 approved before, none valid now
 *  PENDING                 only versions waiting for review
 *  NONE                    no agreement on file (e.g. a new draft FLO)
 */
export const AGREEMENT_SUMMARY_STATUSES = [
  'ACTIVE',
  'EXPIRING_SOON',
  'SCHEDULED',
  'EXPIRED',
  'PENDING',
  'REVOKED',
  'NONE',
] as const;
export type AgreementSummaryStatus = (typeof AGREEMENT_SUMMARY_STATUSES)[number];

/** Need band of the latest CONFIRMED assessment (fresh = unexpired and ≤ 30 days old). */
export const NEED_BANDS = ['HIGH', 'MEDIUM', 'LOW', 'STALE', 'MISSING'] as const;
export type NeedBand = (typeof NEED_BANDS)[number];

/** Responsiveness band of the smoothed R; INSUFFICIENT = no eligible offer yet. */
export const RESPONSE_BANDS = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'] as const;
export type ResponseBand = (typeof RESPONSE_BANDS)[number];

/** Thresholds shared by SQL filters and UI badges. */
export const NEED_BAND_THRESHOLDS = { high: 80, medium: 50 } as const;
export const RESPONSE_BAND_THRESHOLDS = { high: 0.7, medium: 0.4 } as const;

/** Empty strings from HTML GET forms mean "no filter". */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(values).optional());

export const floListQuery = z.object({
  area: optionalEnum(AREAS),
  /** Cluster id (any membership, not only the primary one). */
  cluster: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  type: optionalEnum(FLO_TYPES),
  status: optionalEnum(FLO_STATUSES),
  agreement: optionalEnum(AGREEMENT_SUMMARY_STATUSES),
  need: optionalEnum(NEED_BANDS),
  response: optionalEnum(RESPONSE_BANDS),
  q: z.preprocess((v) => (typeof v === 'string' ? v.trim() || undefined : v), z.string().max(100).optional()),
  cursor: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).max(1024).optional()),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type FloListQuery = z.infer<typeof floListQuery>;
export type FloListFilters = Omit<FloListQuery, 'cursor' | 'limit'>;

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** POST /api/flos — draft creation; nothing is verified implicitly. */
export const createFloBody = z
  .object({
    code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, 'Use capitals, digits and dashes').optional(),
    name: z.string().trim().min(3).max(200),
    flo_type: z.enum(FLO_TYPES),
    service_model: z.string().trim().min(2).max(60),
    area: z.enum(AREAS),
    cluster_id: z.uuid().optional(),
    status: z.enum(FLO_STATUSES).default('PAUSED'),
    address: z.string().trim().max(500).optional(),
    lat: lat.optional(),
    lng: lng.optional(),
    cooking_capable: z.boolean().optional(),
    storage_capabilities: z.array(z.enum(STORAGE_PROFILES)).max(3).optional(),
    halal_required: z.boolean().optional(),
    allergen_exclusions: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng go together',
    path: ['lng'],
  });
export type CreateFloBody = z.infer<typeof createFloBody>;

/** PATCH /api/flos/[id] — revision-guarded profile edit; only listed keys change. */
export const patchFloBody = z
  .object({
    expected_revision: z.number().int().positive(),
    patch: z
      .object({
        name: z.string().trim().min(3).max(200),
        flo_type: z.enum(FLO_TYPES),
        service_model: z.string().trim().min(2).max(60),
        status: z.enum(FLO_STATUSES),
        address: z.string().trim().max(500).nullable(),
        area: z.enum(AREAS),
        lat: lat.nullable(),
        lng: lng.nullable(),
        location_confidence: z.enum(LOCATION_CONFIDENCES),
        cooking_capable: z.boolean(),
        storage_capabilities: z.array(z.enum(STORAGE_PROFILES)).max(3),
        halal_required: z.boolean(),
        allergen_exclusions: z.array(z.string().trim().min(1).max(60)).max(20),
      })
      .partial()
      .strict()
      .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to change' })
      .refine((p) => ('lat' in p) === ('lng' in p) && (p.lat === null) === (p.lng === null), {
        message: 'lat and lng go together',
        path: ['lng'],
      }),
  })
  .strict();
export type PatchFloBody = z.infer<typeof patchFloBody>;

const decimal = z.string().regex(QTY_PATTERN, 'Expected a quantity like "40" or "40.5"');

/**
 * POST /api/flos/[id]/needs
 *  PROPOSE: a proposed (or, with confirm=true and need.confirm, staff-assessed and
 *           confirmed) need assessment.
 *  CONFIRM: confirm an existing proposal.
 */
export const needBody = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('PROPOSE'),
      category_id: z.uuid(),
      score: z.number().min(0).max(100),
      basis: z.string().trim().max(500).optional(),
      requested_qty: decimal.optional(),
      unit: z.string().trim().min(1).max(30).optional(),
      intended_distribution_date: z.iso.date().optional(),
      available_stock_qty: decimal.optional(),
      expected_deliveries_qty: decimal.optional(),
      existing_support: z.string().trim().max(500).optional(),
      valid_days: z.number().int().min(1).max(90).default(30),
      confirm: z.boolean().default(false),
    })
    .strict()
    .refine((v) => v.requested_qty === undefined || !!v.unit, { message: 'A quantity needs a unit', path: ['unit'] }),
  z.object({ action: z.literal('CONFIRM'), need_id: z.uuid() }).strict(),
]);
export type NeedBody = z.infer<typeof needBody>;
