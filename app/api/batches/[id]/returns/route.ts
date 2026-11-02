import {inventoryRoute} from '@/src/application/inventory/routes';
import {returnBody} from '@/src/contracts/inventory';
export const POST=inventoryRoute('return','inventory.receive',returnBody,'/api/batches/[id]/returns',false);
