import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('food_listings')
    .select('id, item_name, food_type, quantity_kg, storage_type, expiry_at, agreed_to_regulations, created_at, decision_details, donor:donors(id, name, type, address, status)')
    .eq('status', 'pending')
    // Soonest-to-spoil first, not oldest-submitted-first — a donation with
    // an hour of shelf life left needs staff eyes before one that's been
    // sitting a day but is still good for a week, regardless of which was
    // submitted first.
    .order('expiry_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ listings: data ?? [] });
}
