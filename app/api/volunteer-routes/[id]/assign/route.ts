import { volunteerCommandRoute } from '@/src/application/volunteers/routes';
import { assignVolunteerRouteBody } from '@/src/contracts/volunteers';

export const POST = volunteerCommandRoute('assign', 'route.manage', assignVolunteerRouteBody, '/api/volunteer-routes/[id]/assign');
