import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { PARTNER_BENEFICIARIES } from '@/lib/data/beneficiaries';
import { calculateJainFairnessIndex } from '@/lib/algorithms/jain-fairness';
import type { BeneficiaryQuotaView, BeneficiaryResponse } from '@/lib/types';

/**
 * The demand-quota network view: every registered partner beneficiary with
 * how much of today's quota is actually filled, plus Jain's Fairness Index
 * across them — the same fairness maths already used for branches, applied
 * one layer downstream to the orgs that actually receive the food.
 */
export async function GET() {
  const supabase = createServerClient();

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: allocRows, error } = await supabase
    .from('beneficiary_allocations')
    .select('beneficiary_key, quantity_kg')
    .gte('allocated_at', todayStart.toISOString());

  // Migration 008 not applied yet — every beneficiary just reads as 0% filled
  // rather than the page silently looking empty or erroring.
  const trackingAvailable = !error;
  if (error) {
    console.error(
      '[beneficiaries] beneficiary_allocations query failed — quota fulfilment will show as 0 for everyone. ' +
        'If this mentions "beneficiary_allocations", run supabase/migrations/008_beneficiary_allocations.sql. Cause:',
      error.message
    );
  }

  const fulfilledByKey = new Map<string, number>();
  for (const row of allocRows ?? []) {
    fulfilledByKey.set(row.beneficiary_key, (fulfilledByKey.get(row.beneficiary_key) ?? 0) + row.quantity_kg);
  }

  const beneficiaries: BeneficiaryQuotaView[] = Object.entries(PARTNER_BENEFICIARIES).flatMap(([area, orgs]) =>
    orgs.map((b) => {
      const fulfilled = fulfilledByKey.get(b.key) ?? 0;
      return {
        key: b.key,
        name: b.name,
        type: b.type,
        area,
        daily_quota_kg: b.daily_quota_kg,
        fulfilled_today_kg: Number(fulfilled.toFixed(1)),
        quota_pct: b.daily_quota_kg > 0 ? Math.round((fulfilled / b.daily_quota_kg) * 100) : 0,
        serves: b.serves,
      };
    })
  );

  const fairnessIndex = calculateJainFairnessIndex(
    beneficiaries.map((b) => ({ current_load_kg: b.fulfilled_today_kg, capacity_kg: b.daily_quota_kg }))
  );

  const response: BeneficiaryResponse = {
    beneficiaries: beneficiaries.sort((a, b) => b.quota_pct - a.quota_pct),
    fairness_index: Number(fairnessIndex.toFixed(4)),
    tracking_available: trackingAvailable,
  };

  return NextResponse.json(response);
}
