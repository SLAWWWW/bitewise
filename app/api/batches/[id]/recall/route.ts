import {inventoryRoute} from '@/src/application/inventory/routes';
import {z} from 'zod';
export const POST=inventoryRoute('recall','inventory.recall',z.object({reason:z.string().trim().min(3).max(3000)}).strict(),'/api/batches/[id]/recall',false);
