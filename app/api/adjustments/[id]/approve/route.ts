import {inventoryRoute} from '@/src/application/inventory/routes';
import {approvalBody} from '@/src/contracts/direct';
export const POST=inventoryRoute('approve-adjust','inventory.adjust.approve',approvalBody,'/api/adjustments/[id]/approve',false);
