import { describe, expect, it } from 'vitest';
import {
  assignVolunteerRouteBody,
  publishVolunteerRouteBody,
  volunteerProfileBody,
  volunteerRouteProgressBody,
} from '@/src/contracts/volunteers';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('volunteer route contracts', () => {
  it('normalises a valid weekly volunteer profile', () => {
    const parsed = volunteerProfileBody.parse({
      status: 'ACTIVE',
      vehicle_type: 'MOTORBIKE',
      max_load_kg: 25,
      refrigerated: false,
      home_area: 'Jakarta Timur',
      available_dows: [6, 1, 1, 3],
      available_start: '07:00',
      available_end: '18:00',
      availability_note: '',
    });
    expect(parsed.available_dows).toEqual([1, 3, 6]);
  });

  it('rejects invalid hours and incomplete failure reports', () => {
    expect(volunteerProfileBody.safeParse({
      status: 'ACTIVE', vehicle_type: 'CAR', max_load_kg: 80, refrigerated: false,
      home_area: 'Depok', available_dows: [1], available_start: '18:00', available_end: '08:00',
    }).success).toBe(false);
    expect(volunteerRouteProgressBody.safeParse({ expected_revision: 1, action: 'fail', failure_code: 'OTHER', note: 'x' }).success).toBe(false);
  });

  it('accepts publish, assignment and ordered progress inputs', () => {
    expect(publishVolunteerRouteBody.parse({ delivery_id: uuid })).toEqual({ delivery_id: uuid });
    expect(assignVolunteerRouteBody.parse({ expected_revision: 1, volunteer_user_id: uuid })).toEqual({ expected_revision: 1, volunteer_user_id: uuid });
    expect(volunteerRouteProgressBody.parse({ expected_revision: 2, action: 'arrive-pickup' }).action).toBe('arrive-pickup');
  });
});
