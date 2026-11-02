import {inventoryRoute} from '@/src/application/inventory/routes';
import {adjustmentBody} from '@/src/contracts/inventory';
export const POST=inventoryRoute('adjust','inventory.adjust.request',adjustmentBody,'/api/adjustments',true);
