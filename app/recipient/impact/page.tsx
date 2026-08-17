'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Recycle, Utensils, Cloud, Award, MapPin, Hourglass, ChevronDown, Route } from 'lucide-react';
import { PublicShell } from '@/components/layout/PublicShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatCard } from '@/components/dashboard/StatCard';
import { SupplyChainPlan } from '@/components/dashboard/SupplyChainPlan';
import { Skeleton, EmptyState } from '@/components/ui/Skeleton';
import { fetchJson } from '@/lib/utils/fetch-json';
import type { RecipientDashboardResponse, RecipientProfile, ActiveClaimSummary } from '@/lib/types';

const PROFILE_KEY = 'bitewise_recipient_profile';

function getStoredProfile(): RecipientProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as RecipientProfile) : null;
  } catch {
    return null;
  }
}

/** One active reservation, with its Supply Chain Planner output collapsed
 *  behind a toggle — the same transparency staff get, shown here so a claim
 *  is never a black box about how it got to the shelf. */
function ActiveClaimTile({ claim }: { claim: ActiveClaimSummary }) {
  const [showPlan, setShowPlan] = useState(false);

  return (
    <GlassCard className="p-4 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <span className="text-title-2">{claim.item_name}</span>
          <span className="text-caption capitalize">
            {claim.food_type} · {claim.quantity}
            {claim.unit === 'kg' ? 'kg' : ` ${claim.unit}`}
          </span>
        </div>
      </div>

      {claim.branch_name && (
        <div className="flex items-center gap-1.5 text-caption">
          <MapPin size={12} style={{ flexShrink: 0 }} />
          <span>
            Collect from <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{claim.branch_name}</strong>
            {claim.branch_area ? ` · ${claim.branch_area}` : ''}
          </span>
        </div>
      )}

      {claim.pickup_deadline_at && (
        <div className="flex items-center gap-1.5 text-caption" style={{ color: 'var(--warning)' }}>
          <Hourglass size={12} style={{ flexShrink: 0 }} />
          Pickup deadline: {new Date(claim.pickup_deadline_at).toLocaleString('en-SG', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {claim.listing_id && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowPlan((v) => !v)}
            className="flex items-center gap-1.5 text-caption"
            style={{ cursor: 'pointer', width: 'fit-content', color: 'var(--accent)' }}
            aria-expanded={showPlan}
          >
            <Route size={12} />
            How this got to you
            <ChevronDown size={12} style={{ transform: showPlan ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease' }} />
          </button>
          {showPlan && (
            <div className="glass-card-nested p-3 rise-in">
              <SupplyChainPlan listingId={claim.listing_id} cachedPlan={claim.supply_chain_plan} />
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

export default function RecipientImpactPage() {
  const [profileId, setProfileId] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<RecipientDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getStoredProfile();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileId(stored?.id ?? null);
  }, []);

  useEffect(() => {
    if (profileId === undefined) return;
    if (profileId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    function load() {
      fetchJson<RecipientDashboardResponse>(`/api/recipient/dashboard?profile_id=${profileId}`)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [profileId]);

  if (profileId === null) {
    return (
      <PublicShell wide>
        <EmptyState
          icon={<Award size={19} color="var(--text-tertiary)" />}
          title="No impact yet"
          description="Claim your first item to start building your impact — your totals will show up here."
        />
        <div className="flex justify-center mt-4">
          <Link href="/recipient" className="btn btn-primary">
            Browse available food
          </Link>
        </div>
      </PublicShell>
    );
  }

  if (loading) {
    return (
      <PublicShell wide>
        <Skeleton height={140} />
        <div style={{ height: 16 }} />
        <Skeleton height={200} />
      </PublicShell>
    );
  }

  const profile = data?.profile;
  const activeClaims = data?.active_claims ?? [];

  return (
    <PublicShell wide>
      <div className="flex flex-col items-center text-center gap-2 mb-8">
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 44, height: 44, background: 'var(--success)' }}
        >
          <Award size={22} color="#fff" />
        </div>
        <h1 className="text-title-1">{profile ? `${profile.name}'s Impact` : 'Your Impact'}</h1>
        <p className="text-body" style={{ color: 'var(--text-secondary)', maxWidth: 420 }}>
          Every item you collect is food that didn&apos;t go to landfill. Here&apos;s what that&apos;s added up to.
        </p>
      </div>

      {profile && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard label="Food Rescued" value={profile.total_kg_claimed} suffix="kg" icon={Recycle} accent="var(--success)" />
            <StatCard label="Meals Equivalent" value={profile.meals_equivalent} icon={Utensils} accent="var(--accent)" />
            <StatCard label="CO₂ Avoided" value={profile.co2_avoided_kg} suffix="kg" icon={Cloud} accent="var(--info)" />
            <StatCard label="Sustainability Score" value={profile.sustainability_score} suffix="/ 100" icon={Award} accent="var(--warning)" />
          </div>
          <p className="text-caption" style={{ color: 'var(--text-tertiary)', marginBottom: 28 }}>
            Sustainability score: 1.5 points per kg of food you&apos;ve rescued from going to waste, capped at 100. You&apos;ve
            completed {profile.donations_completed_count} collection{profile.donations_completed_count === 1 ? '' : 's'} so far.
          </p>
        </>
      )}

      <h2 className="text-title-2 mb-3">Active Reservations</h2>
      {activeClaims.length === 0 ? (
        <EmptyState
          icon={<Utensils size={19} color="var(--text-tertiary)" />}
          title="Nothing reserved right now"
          description="Items you claim will show up here, with the same behind-the-scenes planning staff see."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 items-start">
          {activeClaims.map((claim) => (
            <ActiveClaimTile key={claim.claim_id} claim={claim} />
          ))}
        </div>
      )}
    </PublicShell>
  );
}
