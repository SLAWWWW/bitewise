import {z} from 'zod';
import {qtyString} from '@/src/lib/qty';
import {revisionBody} from './direct';
export const submissionBody=revisionBody.extend({note:z.string().trim().max(6000).default(''),media_ids:z.array(z.uuid()).max(12).default([])});
export const reviewBody=revisionBody.extend({outcome:z.enum(['ADEQUATE','NEEDS_CLARIFICATION','REJECTED_FINAL']),comments:z.string().trim().min(3).max(3000),
  checklist:z.object({correct_subject:z.boolean(),quantity_plausible:z.boolean(),privacy_appropriate:z.boolean()}).strict()});
export const excuseBody=revisionBody.extend({category:z.string().trim().min(2).max(100),reason:z.string().trim().min(3).max(3000)});
export const distributionBody=z.object({receipt_id:z.uuid(),occurred_at:z.iso.datetime({offset:true}),people_reported:z.number().int().min(0).max(100000),
  lines:z.array(z.object({receipt_line_id:z.uuid(),distributed_quantity:qtyString,loss_quantity:qtyString.default('0'),reported_consumed_quantity:qtyString.nullable().default(null)}).strict()).min(1).max(20)}).strict();
export const conversationBody=revisionBody.extend({summary:z.string().trim().max(6000).optional(),text:z.string().trim().max(6000).optional()});
export const linkBody=z.object({subject_type:z.enum(['DELIVERY','ALLOCATION']),subject_id:z.uuid(),hours:z.number().int().min(1).max(168).default(72)}).strict();
