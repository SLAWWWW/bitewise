import { NextResponse } from 'next/server';

/**
 * A shared-secret deterrent, not real authentication — there is no login
 * system in this app. It exists solely to stop a public visitor from
 * mutating staff-only state (approve/reject a donation, fake a pickup,
 * advance a fleet run) directly via the browser console or a raw curl,
 * bypassing the UI entirely. Real per-user auth with roles is out of scope
 * for this build; this closes the specific "someone in the audience opens
 * dev tools" risk instead.
 */
export function requireStaffKey(request: Request): NextResponse | null {
  const expected = process.env.STAFF_API_KEY;
  if (!expected) return null; // not configured — don't lock out a demo that hasn't set one up

  const provided = request.headers.get('x-staff-key');
  if (provided !== expected) {
    return NextResponse.json({ error: 'Missing or invalid staff key.' }, { status: 401 });
  }
  return null;
}
