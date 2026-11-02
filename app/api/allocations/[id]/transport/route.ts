import { commandRoute } from '@/src/application/direct/routes';
import { transportBody } from '@/src/contracts/direct';

export const POST = commandRoute('transport', 'transport.edit', transportBody, '/api/allocations/[id]/transport');
