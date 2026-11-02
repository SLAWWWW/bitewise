import { commandRoute } from '@/src/application/direct/routes';
import { receiptBody } from '@/src/contracts/direct';

export const POST = commandRoute('receive', 'delivery.receive', receiptBody, '/api/deliveries/[id]/receive');
