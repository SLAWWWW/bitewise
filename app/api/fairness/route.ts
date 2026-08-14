import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { calculateJainFairnessIndex } from '@/lib/algorithms/jain-fairness';
import type { Branch, FairnessResponse } from '@/lib/types';

export async function GET() {
  const supabase = createServerClient();

  const { data: branches, error: branchesError } = await supabase
    .from('branches')
    .select('*')
    .order('name', { ascending: true });

  if (branchesError || !branches) {
    return NextResponse.json(
      { error: branchesError?.message ?? 'Failed to load branches' },
      { status: 500 }
    );
  }

  const { data: listings, error: listingsError } = await supabase
    .from('food_listings')
    .select('quantity_kg, status');

  if (listingsError) {
    return NextResponse.json({ error: listingsError.message }, { status: 500 });
  }

  // 'pending' listings haven't been NGO-approved yet, so they aren't committed
  // to any branch — only count food that has actually been matched onward.
  const totalRescuedKg = (listings ?? [])
    .filter((l) => l.status === 'matched' || l.status === 'in_transit' || l.status === 'delivered')
    .reduce((sum, l) => sum + (l.quantity_kg ?? 0), 0);

  const activeDeliveries = (listings ?? []).filter(
    (l) => l.status === 'matched' || l.status === 'in_transit'
  ).length;

  const jainIndex = calculateJainFairnessIndex(branches as Branch[]);

  const response: FairnessResponse = {
    jain_index: Number(jainIndex.toFixed(4)),
    branches: (branches as Branch[]).map((b) => ({
      id: b.id,
      name: b.name,
      area: b.area,
      color: b.color,
      lat: b.lat,
      lng: b.lng,
      ratio: b.capacity_kg > 0 ? Number((b.current_load_kg / b.capacity_kg).toFixed(4)) : 0,
      current_load_kg: b.current_load_kg,
      capacity_kg: b.capacity_kg,
    })),
    total_rescued_kg: Number(totalRescuedKg.toFixed(1)),
    meals_equivalent: Math.round(totalRescuedKg * 2),
    co2_avoided_kg: Number((totalRescuedKg * 2.5).toFixed(1)),
    active_deliveries: activeDeliveries,
  };

  return NextResponse.json(response);
}
