import { describe, it, expect, afterEach } from 'vitest';
import { requireStaffKey } from '@/lib/staff-auth';

describe('requireStaffKey', () => {
  const ORIGINAL = process.env.STAFF_API_KEY;

  afterEach(() => {
    process.env.STAFF_API_KEY = ORIGINAL;
  });

  it('fails open (allows the request) when STAFF_API_KEY is not configured', () => {
    delete process.env.STAFF_API_KEY;
    const req = new Request('http://localhost/api/approvals/1/approve', { method: 'POST' });
    expect(requireStaffKey(req)).toBeNull();
  });

  it('rejects a request with no x-staff-key header once configured', async () => {
    process.env.STAFF_API_KEY = 'correct-key';
    const req = new Request('http://localhost/api/approvals/1/approve', { method: 'POST' });
    const res = requireStaffKey(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('rejects a request with the wrong x-staff-key value', () => {
    process.env.STAFF_API_KEY = 'correct-key';
    const req = new Request('http://localhost/api/approvals/1/approve', {
      method: 'POST',
      headers: { 'x-staff-key': 'wrong-key' },
    });
    const res = requireStaffKey(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('allows a request with the correct x-staff-key value', () => {
    process.env.STAFF_API_KEY = 'correct-key';
    const req = new Request('http://localhost/api/approvals/1/approve', {
      method: 'POST',
      headers: { 'x-staff-key': 'correct-key' },
    });
    expect(requireStaffKey(req)).toBeNull();
  });
});
