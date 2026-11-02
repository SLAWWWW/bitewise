import {inventoryRoute} from '@/src/application/inventory/routes';
import {disposeBody} from '@/src/contracts/inventory';
export const POST=inventoryRoute('dispose','inventory.recall',disposeBody,'/api/batches/[id]/dispose');
