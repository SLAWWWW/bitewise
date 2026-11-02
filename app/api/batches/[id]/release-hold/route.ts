import {inventoryRoute} from '@/src/application/inventory/routes';
import {holdBody} from '@/src/contracts/inventory';
export const POST=inventoryRoute('release-hold','inventory.quarantine_release',holdBody,'/api/batches/[id]/release-hold',false);
