import { commandRoute } from '@/src/application/direct/routes';
import { approvalBody } from '@/src/contracts/direct';

export const POST = commandRoute('approve-outreach', 'outreach.approve', approvalBody, '/api/campaigns/[id]/approve');
