import {inventoryRoute} from '@/src/application/inventory/routes';
import {inspectionBody} from '@/src/contracts/inventory';
export const POST=inventoryRoute('receive','inventory.inspect',inspectionBody,'/api/inbounds/[id]/receive',false);
