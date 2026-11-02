import { commandRoute } from '@/src/application/direct/routes';
import { revisionBody } from '@/src/contracts/direct';

export const POST = commandRoute('validate', 'donation.validate', revisionBody, '/api/donations/[id]/validate');
