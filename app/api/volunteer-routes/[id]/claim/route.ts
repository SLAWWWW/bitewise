import { volunteerCommandRoute } from '@/src/application/volunteers/routes';
import { routeRevisionBody } from '@/src/contracts/volunteers';

export const POST = volunteerCommandRoute('claim', 'route.claim', routeRevisionBody, '/api/volunteer-routes/[id]/claim');
