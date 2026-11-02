import { commandRoute } from '@/src/application/direct/routes';
import { approvalBody } from '@/src/contracts/direct';

export const POST = commandRoute('release', 'reservation.release', approvalBody, '/api/allocations/[id]/release');
