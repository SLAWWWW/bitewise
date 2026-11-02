import { commandRoute } from '@/src/application/direct/routes';
import { approvalBody } from '@/src/contracts/direct';

export const POST = commandRoute('approve-dispatch', 'dispatch.approve', approvalBody, '/api/allocations/[id]/approve-dispatch');
