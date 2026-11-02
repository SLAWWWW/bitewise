import { commandRoute } from '@/src/application/direct/routes';
import { dispatchBody } from '@/src/contracts/direct';

export const POST = commandRoute('dispatch', 'delivery.dispatch', dispatchBody, '/api/deliveries/[id]/dispatch');
