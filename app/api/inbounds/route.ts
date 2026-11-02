import {inventoryRoute} from '@/src/application/inventory/routes';
import {inboundBody} from '@/src/contracts/inventory';
export const POST=inventoryRoute('inbound','inventory.receive',inboundBody,'/api/inbounds',true);
