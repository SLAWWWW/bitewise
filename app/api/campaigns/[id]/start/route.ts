import { commandRoute } from '@/src/application/direct/routes';
import { revisionBody } from '@/src/contracts/direct';

export const POST = commandRoute('start', 'campaign.start', revisionBody, '/api/campaigns/[id]/start');
