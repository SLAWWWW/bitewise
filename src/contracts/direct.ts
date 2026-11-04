import { z } from 'zod';
import { parseDbQty, positiveQtyString, qtyString } from '@/src/lib/qty';
import { DECLINE_REASON_CODES } from '@/src/shared/codes';

export const revisionBody = z.object({ expected_revision: z.number().int().positive() }).strict();
export const approvalBody = revisionBody.extend({ reason: z.string().trim().min(3).max(1000) });
export const donationBody = z.object({
  donor_id: z.uuid(), source_location_id: z.uuid(),
  pickup_start: z.iso.datetime({ offset: true }), pickup_end: z.iso.datetime({ offset: true }),
  donation_reason: z.enum(['SURPLUS','NEAR_EXPIRY','COSMETIC_PRODUCE','OUTER_PACKAGING_DAMAGE','PRODUCTION_EXCESS','OTHER']),
  items: z.array(z.object({ product_id: z.uuid(), quantity: positiveQtyString, unit: z.string().min(1).max(30),
    est_weight_kg:qtyString.optional(),measured_weight_kg:qtyString.optional(),weight_provenance:z.enum(['ESTIMATED','MEASURED']).optional(),
    condition: z.enum(['GOOD','OUTER_PACKAGING_DAMAGE','INNER_SEAL_DAMAGED','SPOILED','UNKNOWN']),
    distribute_by: z.iso.datetime({ offset: true }),
    prep_info: z.object({ ready_at: z.iso.datetime({ offset: true }).optional(), handling_confirmed: z.boolean().optional() }).strict().default({}),
    label_info: z.object({ expiry_at: z.iso.datetime({ offset: true }).optional() }).strict().default({}),
  }).strict()).min(1).max(20),
}).strict().refine(p => Date.parse(p.pickup_end) > Date.parse(p.pickup_start), { message: 'Invalid pickup window' });
export const planBody = z.object({ item_id: z.uuid(), receipt_at: z.iso.datetime({ offset: true }), distribution_at: z.iso.datetime({ offset: true }) }).strict();
export const campaignBody = z.object({ run_id: z.uuid(), lines: z.array(z.object({ flo_id: z.uuid(), quantity: positiveQtyString }).strict()).min(1).max(3).optional(),
  reason: z.string().trim().min(3).max(1000).optional() }).strict().refine(p=>!p.lines||!!p.reason,{message:'A plan override needs a reason'});
export const responseBody = z.discriminatedUnion('response', [
  revisionBody.extend({ response: z.literal('ACCEPT'), quantity: positiveQtyString }),
  revisionBody.extend({ response: z.literal('PARTIAL_ACCEPT'), quantity: positiveQtyString }),
  revisionBody.extend({ response: z.literal('DECLINE'), reason: z.enum(DECLINE_REASON_CODES) }),
]);
export const transportBody = revisionBody.extend({
  method: z.enum(['SELF_PICKUP','FLO_BOOKED_COURIER','FOODCYCLE_COORDINATED_COURIER']),
  decision: z.enum(['ACCEPT','REFUSE']), contact_id: z.uuid(), arranger: z.string().trim().min(3).max(300),
  fee_idr: z.number().int().min(0).max(2147483647).nullable(),
});
export const dispatchBody = revisionBody.extend({ custodian: z.string().trim().min(3).max(300) });
const inspectionFinding = z.enum(['PASS','CONCERN']);
export const receiptInspectionBody = z.object({
  smell: inspectionFinding,
  appearance: inspectionFinding,
  texture: inspectionFinding,
  packaging: inspectionFinding,
  taste: z.enum(['NOT_PERFORMED','PASS','CONCERN']),
  notes: z.string().trim().max(1000).optional(),
}).strict();
export const receiptBody = revisionBody.extend({
  accepted_quantity: qtyString,
  rejected_quantity: qtyString,
  reason: z.string().trim().max(1000).optional(),
  inspection: receiptInspectionBody,
}).superRefine((value, ctx) => {
  const concern = value.inspection.taste === 'CONCERN'
    || [value.inspection.smell, value.inspection.appearance, value.inspection.texture, value.inspection.packaging].includes('CONCERN');
  if (!concern) return;
  if (parseDbQty(value.rejected_quantity) === 0n) ctx.addIssue({ code: 'custom', path: ['rejected_quantity'], message: 'An inspection concern requires a rejected quantity' });
  if ((value.inspection.notes?.length ?? 0) < 3) ctx.addIssue({ code: 'custom', path: ['inspection','notes'], message: 'Describe the inspection concern' });
});
export const clockBody = z.object({ minutes: z.number().int().min(1).max(44640) }).strict();
export const reviseBody=revisionBody.extend({condition:z.enum(['GOOD','UNKNOWN','OUTER_PACKAGING_DAMAGE','INNER_SEAL_DAMAGED','SPOILED']),
  prep_info:z.object({ready_at:z.iso.datetime({offset:true}).optional(),handling_confirmed:z.boolean().optional()}).strict(),
  label_info:z.object({expiry_at:z.iso.datetime({offset:true}).optional()}).strict(),reason:z.string().trim().min(3).max(1000)});
