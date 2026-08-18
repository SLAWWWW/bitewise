'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Recycle, Utensils, Truck, Leaf, Clock3, XCircle, ArrowRight } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { StatCard } from '@/components/dashboard/StatCard';
import { FairnessGauge } from '@/components/dashboard/FairnessGauge';
import { NgoSaturationBar } from '@/components/dashboard/NgoSaturationBar';
import { SimulateButton, type SimulateResult } from '@/components/dashboard/SimulateButton';
import { DonationFlowPanel } from '@/components/dashboard/DonationFlowPanel';
import { FleetSummaryPanel } from '@/components/dashboard/FleetSummaryPanel';
import { StorageSummaryPanel } from '@/components/dashboard/StorageSummaryPanel';
import { HistoryPanel } from '@/components/dashboard/HistoryPanel';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import { fetchJson } from '@/lib/utils/fetch-json';
import type { Donor, FairnessResponse } from '@/lib/types';
import type { ActiveRoute } from '@/components/dashboard/CityMap';

const CityMap = dynamic(() => import('@/components/dashboard/CityMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-caption">Loading map…</div>
  ),
});

export default function OrchestratorPage() {
  const [fairness, setFairness] = useState<FairnessResponse | null>(null);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null);
  const [lastSubmission, setLastSubmission] = useState<SimulateResult | null>(null);
  const routeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFairness = useCallback(async () => {
    try {
      setFairness(await fetchJson<FairnessResponse>('/api/fairness'));
    } catch {
      // Keep previous fairness data on transient error.
    }
  }, []);

  const fetchDonors = useCallback(async () => {
    try {
      const data = await fetchJson<{ donors: Donor[] }>('/api/donors');
      setDonors(data.donors ?? []);
    } catch {
      // Keep previous donors on transient error.
    }
  }, []);

  useEffect(() => {
    // Initial data load — fetchFairness/fetchDonors are also reused by the
    // realtime subscription and post-simulate refetch below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFairness();
    fetchDonors();
  }, [fetchFairness, fetchDonors]);

  useEffect(() => {
    const channel = supabase
      .channel('branches-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'branches' }, () => {
        fetchFairness();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchFairness]);

  useEffect(() => {
    return () => {
      if (routeTimeoutRef.current) clearTimeout(routeTimeoutRef.current);
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    };
  }, []);

  function handleSubmitted(result: SimulateResult) {
    setLastSubmission(result);

    if (
      result.success &&
      result.suggested_branch_lat != null &&
      result.suggested_branch_lng != null
    ) {
      if (routeTimeoutRef.current) clearTimeout(routeTimeoutRef.current);
      setActiveRoute({
        id: `${result.suggested_branch_id}-${result.donor.id}-${Math.random()}`,
        donorLat: result.donor.lat,
        donorLng: result.donor.lng,
        branchLat: result.suggested_branch_lat,
        branchLng: result.suggested_branch_lng,
        color: result.suggested_branch_color ?? 'var(--accent)',
      });
      routeTimeoutRef.current = setTimeout(() => setActiveRoute(null), 5000);
    }

    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    bannerTimeoutRef.current = setTimeout(() => setLastSubmission(null), 10000);
  }

  const mapBranches =
    fairness?.branches.map((b) => ({
      id: b.id,
      name: b.name,
      area: b.area,
      lat: b.lat,
      lng: b.lng,
      capacity_kg: b.capacity_kg,
      current_load_kg: b.current_load_kg,
      color: b.color,
    })) ?? [];

  return (
    <AppShell
      title="Network Overview"
      subtitle="One connected system coordinating donations across all 5 Willing Hearts branches."
    >
      <div className="grid-stats mb-5">
        <StatCard
          label="Total Food Rescued"
          value={fairness?.total_rescued_kg ?? 0}
          suffix="kg"
          icon={Recycle}
          accent="var(--success)"
        />
        <StatCard
          label="Meals Equivalent"
          value={fairness?.meals_equivalent ?? 0}
          icon={Utensils}
          accent="var(--accent)"
          tooltip="Estimated as 2 meals per kg of food rescued — a standard charity-sector conversion, not a count of meals actually served."
        />
        <StatCard
          label="CO₂ Avoided"
          value={fairness?.co2_avoided_kg ?? 0}
          suffix="kg"
          icon={Leaf}
          accent="var(--info)"
          tooltip="Estimated as 2.5kg of CO₂-equivalent avoided per kg of food rescued from landfill — a standard sector conversion factor, not a direct emissions measurement."
        />
        <StatCard
          label="Active Deliveries"
          value={fairness?.active_deliveries ?? 0}
          icon={Truck}
          accent="var(--warning)"
        />
      </div>

      <div className="grid-main">
        {/* Primary bento card — no colour border, just a deeper shadow */}
        <GlassCard variant="primary" className="p-2 overflow-hidden map-card">
          <CityMap donors={donors} branches={mapBranches} activeRoute={activeRoute} />
        </GlassCard>

        <div className="flex flex-col gap-4">
          <GlassCard className="flex flex-col items-center" style={{ padding: '28px 24px' }}>
            <FairnessGauge
              jainIndex={fairness?.jain_index ?? 1}
              branchCount={mapBranches.length || 5}
              totalLoadKg={mapBranches.reduce((s, b) => s + b.current_load_kg, 0)}
            />
          </GlassCard>

          <GlassCard className="flex flex-col gap-4" style={{ padding: '22px 22px' }}>
            <div className="flex items-center justify-between">
              <span className="text-overline">Branch Saturation</span>
              <span className="text-caption tnum" style={{ fontSize: 10.5 }}>
                {mapBranches.length > 0
                  ? `${mapBranches.reduce((s, b) => s + b.current_load_kg, 0).toLocaleString('en-SG')} / ${mapBranches.reduce((s, b) => s + b.capacity_kg, 0).toLocaleString('en-SG')} kg`
                  : ''}
              </span>
            </div>
            {mapBranches.length === 0
              ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={30} />)
              : mapBranches.map((b) => (
                  <NgoSaturationBar
                    key={b.id}
                    name={b.name.replace('Willing Hearts — ', '')}
                    area={b.area}
                    color={b.color}
                    currentLoadKg={b.current_load_kg}
                    capacityKg={b.capacity_kg}
                  />
                ))}
          </GlassCard>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3" style={{ maxWidth: 460 }}>
        <SimulateButton donors={donors} onSubmitted={handleSubmitted} />
        {lastSubmission && (
          <GlassCard className="p-4 flex items-start gap-3 rise-in">
            {lastSubmission.success ? (
              <Clock3 size={18} color="var(--monitor)" style={{ marginTop: 2, flexShrink: 0 }} />
            ) : (
              <XCircle size={18} color="var(--critical)" style={{ marginTop: 2, flexShrink: 0 }} />
            )}
            <div className="text-body flex flex-col gap-2 min-w-0">
              {lastSubmission.success ? (
                <span>
                  Submitted <strong>{lastSubmission.quantityKg}kg</strong> from{' '}
                  <strong>{lastSubmission.donor.name}</strong> — suggested branch:{' '}
                  <strong>{lastSubmission.suggested_branch ?? 'none available'}</strong>
                  {lastSubmission.distance_km != null && ` (${lastSubmission.distance_km}km away)`}.
                  Awaiting NGO approval.
                </span>
              ) : (
                <span>{lastSubmission.message}</span>
              )}
              <Link
                href="/approvals"
                className="text-caption flex items-center gap-1"
                style={{ color: 'var(--accent)' }}
              >
                Review in Pending Approvals <ArrowRight size={12} />
              </Link>
            </div>
          </GlassCard>
        )}
      </div>

      {/* Command Center — every donation's real journey (approve → plan →
          dispatch → arrive → claimed) as one clickable feed, with fleet and
          storage overviews alongside for what isn't tied to a single
          donation. Everything here is actionable; each panel still links to
          its own dedicated page for the full picture. */}
      <div className="mt-8 mb-4">
        <span className="text-overline">Command Center</span>
      </div>

      <div className="flex flex-col gap-5">
        <DonationFlowPanel />

        <div className="grid-halves">
          <FleetSummaryPanel />
          <StorageSummaryPanel />
        </div>

        <HistoryPanel />
      </div>
    </AppShell>
  );
}
