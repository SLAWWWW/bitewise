import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase-server';
import type { CreateProfileResponse } from '@/lib/types';

const ProfileRequestSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(30).optional(),
});

/**
 * Creates the lightweight recipient identity a claim now requires (PRD §7.8)
 * — a name, optionally a phone number, nothing else. Not authentication:
 * no password, no email verification, nothing to log in with. The client
 * persists the returned id in localStorage and reuses it for every future
 * claim, the same way `anonymous_id` always worked, just no longer nameless.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = ProfileRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: profile, error } = await supabase
    .from('recipient_profiles')
    .insert({ name: parsed.data.name.trim(), phone: parsed.data.phone?.trim() || null })
    .select('id, name, phone, created_at')
    .single();

  if (error || !profile) {
    console.error(
      '[profiles] insert failed. If this mentions "recipient_profiles", run ' +
        'supabase/migrations/009_recipient_profiles.sql. Cause:',
      error?.message
    );
    const response: CreateProfileResponse = {
      success: false,
      message: 'Could not create a profile right now — please try again.',
    };
    return NextResponse.json(response, { status: 500 });
  }

  const response: CreateProfileResponse = { success: true, profile };
  return NextResponse.json(response);
}
