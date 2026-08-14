import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('food_listings')
    .select('id, item_name, food_type, quantity_kg, storage_type, expiry_at, agreed_to_regulations, created_at, decision_details, donor:donors(id, name, type, address, status)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ listings: data ?? [] });
}
