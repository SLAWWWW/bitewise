import { z } from 'zod';

export const volunteerProfileBody = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  vehicle_type: z.enum(['BICYCLE', 'MOTORBIKE', 'CAR', 'VAN']),
  max_load_kg: z.number().positive().max(5000),
  refrigerated: z.boolean(),
  home_area: z.string().trim().min(2).max(120),
  available_dows: z.array(z.number().int().min(1).max(7)).min(1).max(7).transform((days) => [...new Set(days)].sort()),
  available_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  available_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  availability_note: z.string().trim().max(1000).optional(),
}).strict().refine((value) => value.available_end > value.available_start, {
  path: ['available_end'],
  message: 'Availability must end after it starts',
});

export const publishVolunteerRouteBody = z.object({
  delivery_id: z.uuid(),
  volunteer_user_id: z.uuid().optional(),
}).strict();

export const routeRevisionBody = z.object({ expected_revision: z.number().int().positive() }).strict();

export const assignVolunteerRouteBody = routeRevisionBody.extend({ volunteer_user_id: z.uuid() });

export const volunteerRouteProgressBody = routeRevisionBody.extend({
  action: z.enum(['start', 'arrive-pickup', 'pickup', 'depart-dropoff', 'arrive-dropoff', 'handoff', 'fail', 'release', 'cancel']),
  failure_code: z.enum(['NO_SHOW', 'VEHICLE', 'FOOD_UNAVAILABLE', 'SAFETY', 'ACCESS', 'OTHER']).optional(),
  note: z.string().trim().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'fail') {
    if (!value.failure_code) ctx.addIssue({ code: 'custom', path: ['failure_code'], message: 'Failure code is required' });
    if ((value.note?.length ?? 0) < 3) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Describe the route problem' });
  }
});
