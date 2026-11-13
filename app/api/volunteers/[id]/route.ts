import { volunteerCommandRoute } from '@/src/application/volunteers/routes';
import { volunteerProfileBody } from '@/src/contracts/volunteers';

export const POST = volunteerCommandRoute('profile', 'volunteer.manage', volunteerProfileBody, '/api/volunteers/[id]');
