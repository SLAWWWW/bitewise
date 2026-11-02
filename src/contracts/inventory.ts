import {z} from 'zod';
import {positiveQtyString,qtyString,signedQtyString} from '@/src/lib/qty';
import {revisionBody} from './direct';
const instant=z.iso.datetime({offset:true});
export const inboundBody=z.object({donor_id:z.uuid(),source_location_id:z.uuid(),warehouse_id:z.uuid(),expected_at:instant,
  donation_reason:z.enum(['SURPLUS','NEAR_EXPIRY','COSMETIC_PRODUCE','OUTER_PACKAGING_DAMAGE','PRODUCTION_EXCESS','OTHER']),
  items:z.array(z.object({product_id:z.uuid(),quantity:positiveQtyString,unit:z.string().min(1).max(30)}).strict()).min(1).max(20)}).strict();
export const inspectionBody=revisionBody.extend({reason:z.string().trim().min(3).max(3000),complete:z.boolean().default(true),
  lines:z.array(z.object({inbound_line_id:z.uuid(),actual_quantity:qtyString,accepted_quantity:qtyString,quarantined_quantity:qtyString,rejected_quantity:qtyString,
    unit:z.string().min(1).max(30),storage_location_id:z.uuid(),lot:z.string().max(100),expiry_at:instant.nullable(),ready_at:instant.optional(),condition:z.enum(['GOOD','UNKNOWN','DAMAGED','SPOILED']),inspection_reason:z.string().trim().min(3).max(3000)}).strict()).min(1).max(20)});
export const releaseBody=z.object({warehouse_id:z.uuid(),product_id:z.uuid(),quantity:positiveQtyString,pickup_start:instant,pickup_end:instant,receipt_at:instant,distribution_at:instant}).strict();
export const pickBody=revisionBody.extend({reason:z.string().max(3000).optional(),lines:z.array(z.object({pick_line_id:z.uuid(),picked_quantity:qtyString,substitute_batch_id:z.uuid().optional(),reason:z.string().max(3000).optional()}).strict()).min(1).max(100)});
export const adjustmentBody=z.object({batch_id:z.uuid(),delta:signedQtyString,media_id:z.uuid(),reason:z.string().trim().min(3).max(3000),reversal_of:z.uuid().optional()}).strict();
export const holdBody=z.object({quantity:positiveQtyString,reason:z.string().trim().min(3).max(3000),expiry_at:instant.optional(),inspection_passed:z.literal(true)}).strict();
export const returnBody=z.object({quantity:positiveQtyString,reason:z.string().trim().min(3).max(3000),arrived:z.literal(true),from_account:z.enum(['EXCEPTION','DELIVERED','IN_TRANSIT'])}).strict();

export const disposeBody=z.object({quantity:positiveQtyString,reason:z.string().trim().min(3).max(3000),from_account:z.enum(['AVAILABLE','QUARANTINE','EXCEPTION'])}).strict();
