'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  HeartHandshake,
  Route,
  Truck,
  Users,
  Clock3,
  AlertTriangle,
  Snowflake,
  ArrowRightLeft,
  MapPin,
  CheckCircle2,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { SkeletonList, EmptyState } from '@/components/ui/Skeleton';
import { FairnessGauge } from '@/components/dashboard/FairnessGauge';
import { BeneficiaryQuotaBar } from '@/components/dashboard/BeneficiaryQuotaBar';
import { fetchJson } from '@/lib/utils/fetch-json';
import { URGENCY_TOOLTIP } from '@/lib/storage-zones';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { BeneficiaryResponse, DispatchResponse, DispatchRun } from '@/lib/types';

const URGENCY_BADGE: Record<string, string> = {
  expired: 'badge-critical',
  critical: 'badge-critical',
  urgent: 'badge-urgent',
  monitor: 'badge-monitor',
  stable: 'badge-neutral',
};

function RunCard({ run }: { run: DispatchRun }) {
  return (
    <GlassCard
      className="p-4 sm:p-5 flex flex-col gap-4"
      style={
        run.route_exceeds_shelf_life
          ? { borderColor: 'color-mix(in srgb, var(--critical) 45%, transparent)' }
          : undefined
      }
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="flex-shrink-0 rounded-sm"
              style={{ width: 9, height: 9, background: run.color }}
            />
            <span className="text-title-2 truncate">
              {run.branch_name.replace('Willing Hearts — ', '')}
            </span>
            <span className="text-caption" style={{ fontSize: 11 }}>
              {run.area}
            </span>
          </div>
          <span className="text-caption">
            <span className="tnum">{run.item_count}</span> item
            {run.item_count === 1 ? '' : 's'} · <span className="tnum">{run.total_kg}kg</span> ·{' '}
            <span className="tnum">{run.stops.length}</span> stop
            {run.stops.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {run.needs_cold_chain && (
            <span className="badge badge-info">
              <Snowflake size={9} />
              Cold chain
            </span>
          )}
          <span className="badge badge-urgent tnum">
            <Clock3 size={9} />
            {run.soonest_expiry_hours < 1
              ? `${Math.round(run.soonest_expiry_hours * 60)} min`
              : `${run.soonest_expiry_hours.toFixed(1)}h`}{' '}
            on the clock
          </span>
        </div>
      </div>

      {run.route_exceeds_shelf_life && (
        <div className="flex items-start gap-2">
          <AlertTriangle size={13} color="var(--critical)" style={{ marginTop: 2, flexShrink: 0 }} />
          <span className="text-caption" style={{ color: 'var(--critical)' }}>
            The drive alone ({run.route.total_minutes} min) is longer than the shelf life remaining on the
            most urgent item. Split this run or drop the nearest stop first.
          </span>
        </div>
      )}

      <div style={{ borderTop: '0.5px solid var(--border-default)' }} />

      {/* Route */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-overline">Optimised route</span>
          <span className="badge badge-accent tnum">
            <Route size={9} />
            {run.route.total_distance_km}km · {run.route.total_minutes} min
          </span>
          {/* Only claim optimisation when there was actually a choice to make. */}
          <span className="badge badge-neutral" style={{ fontSize: 10 }}>
            {run.route.method === 'heuristic'
              ? 'nearest-neighbour estimate'
              : run.stops.length < 2
                ? 'single stop — direct'
                : `shortest of ${run.route.permutations_considered} orderings`}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {/* Depot */}
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center rounded-lg flex-shrink-0"
              style={{
                width: 28,
                height: 28,
                background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border-default)',
              }}
            >
              <MapPin size={13} color="var(--text-secondary)" />
            </div>
            <span className="text-caption">
              Depart <strong style={{ color: 'var(--text-primary)' }}>
                {run.branch_name.replace('Willing Hearts — ', '')}
              </strong>
            </span>
          </div>

          {run.stops.map((stop, i) => {
            const leg = run.route.legs[i];
            return (
              <div key={stop.name} className="flex gap-2.5">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div
                    style={{
                      width: 1.5,
                      height: 14,
                      background: 'var(--border-strong)',
                      marginLeft: 13,
                    }}
                  />
                  <div
                    className="flex items-center justify-center rounded-lg tnum"
                    style={{
                      width: 28,
                      height: 28,
                      background: 'color-mix(in srgb, var(--branch-3) 16%, var(--bg-elevated))',
                      border: '0.5px solid color-mix(in srgb, var(--branch-3) 45%, transparent)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--branch-3)',
                    }}
                  >
                    {stop.sequence}
                  </div>
                </div>

                <div className="flex flex-col gap-0.5 min-w-0" style={{ paddingTop: 14 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-body" style={{ fontWeight: 600 }}>
                      {stop.name}
                    </span>
                    <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                      {stop.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-caption" style={{ fontSize: 11 }}>
                    {leg && (
                      <span className="tnum">
                        {leg.distance_km}km · {leg.minutes} min
                      </span>
                    )}
                    <span className="tnum">
                      drop {stop.items} item{stop.items === 1 ? '' : 's'} · {stop.kg}kg
                    </span>
                    <span className="flex items-center gap-1 tnum">
                      <Users size={10} />
                      serves ~{stop.serves}
                    </span>
                  </div>
                  <span className="text-caption" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {stop.note}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ borderTop: '0.5px solid var(--border-default)' }} />

      {/* Item → partner assignments */}
      <div className="flex flex-col gap-2">
        <span className="text-overline">Load manifest</span>
        {run.assignments.map((a) => (
          <div key={a.item_id} className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-col min-w-0" style={{ flex: '1 1 200px' }}>
              <span className="text-body truncate">
                {a.item_name}{' '}
                <span className="text-caption tnum">
                  ({a.quantity}
                  {a.unit === 'kg' ? 'kg' : ` ${a.unit}`})
                </span>
              </span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                → {a.partner_name}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {a.compromised && (
                <span className="badge badge-critical" style={{ fontSize: 10 }}>
                  <AlertTriangle size={9} />
                  No suitable partner
                </span>
              )}
              <span className="flex items-center">
                <span className={`badge ${URGENCY_BADGE[a.urgency]} tnum`}>{a.shelf_life_label}</span>
                <InfoTooltip text={URGENCY_TOOLTIP} size={9} />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Vehicle */}
      <div
        className="glass-card-nested p-3 flex items-start gap-2.5"
        style={{
          borderColor: run.suggested_vehicle
            ? 'color-mix(in srgb, var(--accent) 30%, transparent)'
            : 'color-mix(in srgb, var(--warning) 35%, transparent)',
        }}
      >
        <Truck
          size={14}
          color={run.suggested_vehicle ? 'var(--accent)' : 'var(--warning)'}
          style={{ marginTop: 1, flexShrink: 0 }}
        />
        {run.suggested_vehicle ? (
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-body">
                <span className="mono" style={{ fontWeight: 600 }}>
                  {run.suggested_vehicle.label}
                </span>{' '}
                — {run.suggested_vehicle.driver_name}
              </span>
              <span className="badge badge-neutral capitalize" style={{ fontSize: 10 }}>
                {run.suggested_vehicle.type}
              </span>
              {run.suggested_vehicle.is_cross_branch && (
                <span className="badge badge-urgent" style={{ fontSize: 10 }}>
                  <ArrowRightLeft size={9} />
                  from {run.suggested_vehicle.home_branch_name.replace('Willing Hearts — ', '')}
                </span>
              )}
            </div>
            <span className="text-caption" style={{ fontSize: 11 }}>
              <span className="tnum">
                {run.total_kg}kg of {run.suggested_vehicle.capacity_kg}kg
              </span>{' '}
              capacity
              {run.needs_cold_chain && run.suggested_vehicle.type === 'refrigerated'
                ? ' · cold chain maintained'
                : ''}
            </span>
          </div>
        ) : (
          <span className="text-caption" style={{ color: 'var(--warning)' }}>
            {run.no_vehicle_reason}
          </span>
        )}
      </div>
    </GlassCard>
  );
}

/** The primary channel: donations routed to a registered partner by demand
 *  quota at approval time, real-world Willing Hearts/Food Bank style — most
 *  underserved partners surfaced first so staff can see who still needs a
 *  drop today. Distinct from the run cards below, which are the secondary,
 *  reactive channel for whatever nobody claimed in time. */
function BeneficiaryNetworkSection({ data }: { data: BeneficiaryResponse }) {
  const sorted = [...data.beneficiaries].sort((a, b) => a.quota_pct - b.quota_pct);

  return (
    <GlassCard className="p-4 sm:p-5 flex flex-col gap-4 mb-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-title-2">Beneficiary Network</span>
          <span className="text-caption">
            Demand-quota allocation — approved donations go straight to whichever registered partner has
            the most unmet need today, not just whoever&apos;s closest.
          </span>
        </div>
      </div>

      {!data.tracking_available && (
        <div className="flex items-start gap-2">
          <AlertTriangle size={13} color="var(--warning)" style={{ marginTop: 2, flexShrink: 0 }} />
          <span className="text-caption" style={{ color: 'var(--warning)' }}>
            Quota tracking isn&apos;t live yet — run supabase/migrations/008_beneficiary_allocations.sql to
            start recording fulfilment.
          </span>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-5">
        <div className="flex flex-col gap-4" style={{ minWidth: 0, flex: '1 1 320px' }}>
          {sorted.map((b) => (
            <BeneficiaryQuotaBar
              key={b.key}
              name={b.name}
              area={b.area}
              quotaPct={b.quota_pct}
              fulfilledKg={b.fulfilled_today_kg}
              quotaKg={b.daily_quota_kg}
            />
          ))}
        </div>
        <div className="flex-shrink-0 self-center sm:self-start" style={{ width: 148 }}>
          <FairnessGauge
            jainIndex={data.fairness_index}
            branchCount={data.beneficiaries.length}
            unitLabel="partners"
            totalLoadKg={data.beneficiaries.reduce((s, b) => s + b.fulfilled_today_kg, 0)}
          />
        </div>
      </div>
    </GlassCard>
  );
}

export default function DispatchPage() {
  const [data, setData] = useState<DispatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryResponse | null>(null);

  const fetchDispatch = useCallback(async () => {
    try {
      setData(await fetchJson<DispatchResponse>('/api/dispatch'));
    } catch {
      // Keep previous data on transient poll error.
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBeneficiaries = useCallback(async () => {
    try {
      setBeneficiaries(await fetchJson<BeneficiaryResponse>('/api/beneficiaries'));
    } catch {
      // Keep previous data on transient poll error.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDispatch();
    fetchBeneficiaries();
    const interval = setInterval(() => {
      fetchDispatch();
      fetchBeneficiaries();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchDispatch, fetchBeneficiaries]);

  const s = data?.summary;

  return (
    <AppShell
      title="Partner Dispatch"
      subtitle="Demand-quota allocation to the beneficiary network, plus delivery runs for whatever passed the public-claim window unclaimed."
    >
      {beneficiaries && <BeneficiaryNetworkSection data={beneficiaries} />}

      {loading && <SkeletonList count={2} lines={5} />}

      {!loading && data && data.runs.length === 0 && (
        <EmptyState
          icon={<CheckCircle2 size={19} color="var(--success)" />}
          title="Nothing needs reactive partner dispatch"
          description={`No inventory has escalated past the ${s?.escalation_threshold_hours ?? 3}-hour public-claim window. Items appear here automatically once they get that close to spoiling without being claimed.`}
        />
      )}

      {!loading && data && data.runs.length > 0 && (
        <>
          <span className="text-title-2 mb-2" style={{ display: 'block' }}>
            Reactive Escalation
          </span>
          <div className="grid-stats mb-5">
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Runs to schedule</span>
              <span className="text-title-1 tnum">{s?.branches_with_dispatch ?? 0}</span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                {s?.total_items ?? 0} items · {s?.total_kg ?? 0}kg
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">Total driving</span>
              <span className="text-title-1 tnum">{s?.total_distance_km ?? 0}km</span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                across all runs
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">People reached</span>
              <span className="text-title-1 tnum">~{s?.people_reached ?? 0}</span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                combined partner capacity
              </span>
            </GlassCard>
            <GlassCard className="p-4 flex flex-col gap-1">
              <span className="text-overline">At risk</span>
              <span
                className="text-title-1 tnum"
                style={(s?.at_risk_runs ?? 0) > 0 ? { color: 'var(--critical)' } : undefined}
              >
                {s?.at_risk_runs ?? 0}
              </span>
              <span className="text-caption" style={{ fontSize: 11 }}>
                drive exceeds shelf life
              </span>
            </GlassCard>
          </div>

          <div className="flex items-start gap-2 mb-5 text-caption">
            <HeartHandshake size={13} color="var(--branch-3)" style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              Each item is matched to the nearest partner that can actually receive it — cold-chain items
              only go to partners with a chiller, cooked food only to partners who can serve it. Runs are
              ordered most urgent first.
            </span>
          </div>

          <div className="flex flex-col gap-4">
            {data.runs.map((run) => (
              <RunCard key={run.branch_id} run={run} />
            ))}
          </div>

          <p className="text-caption mt-5" style={{ fontSize: 11 }}>
            Routes are open-ended — the vehicle finishes at its last drop rather than returning to the
            branch. Distances use the same great-circle calculation as branch routing; road time assumes an
            urban average with a per-stop handling allowance. This page proposes runs; it doesn&apos;t
            dispatch them.
          </p>
        </>
      )}
    </AppShell>
  );
}
