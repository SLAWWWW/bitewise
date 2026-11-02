import { commandRoute } from '@/src/application/direct/routes';
import { responseBody } from '@/src/contracts/direct';

export const POST = commandRoute('respond', 'offer.respond', responseBody, '/api/offers/[id]/respond');
