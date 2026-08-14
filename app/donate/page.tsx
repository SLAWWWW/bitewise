'use client';

import { useState, type FormEvent } from 'react';
import { HandHeart, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import { PublicShell } from '@/components/layout/PublicShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { FoodSafetyBadge } from '@/components/dashboard/FoodSafetyBadge';
import { SG_AREAS, DONOR_TYPES, type AreaValue } from '@/lib/constants';
import { fetchJson, FetchError } from '@/lib/utils/fetch-json';
import { FOOD_TYPES, type SubmitListingResponse, type FoodSafetyCheckResult } from '@/lib/types';

const STORAGE_TYPES = ['ambient', 'cold', 'frozen'] as const;

const initialForm = {
  donor_name: '',
  donor_type: 'restaurant' as (typeof DONOR_TYPES)[number],
  address: '',
  area: SG_AREAS[0].value as AreaValue,
  item_name: '',
  food_type: FOOD_TYPES[0],
  quantity_kg: '',
  storage_type: 'ambient' as (typeof STORAGE_TYPES)[number],
  expiry_hours: '',
  note: '',
  agreed_to_regulations: false,
};

export default function DonatePage() {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectionCheck, setRejectionCheck] = useState<FoodSafetyCheckResult | null>(null);
  const [result, setResult] = useState<SubmitListingResponse | null>(null);

  function update<K extends keyof typeof initialForm>(key: K, value: (typeof initialForm)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setRejectionCheck(null);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.agreed_to_regulations || submitting) return;
    setSubmitting(true);
    setError(null);
    setRejectionCheck(null);

    try {
      const data = await fetchJson<SubmitListingResponse>('/api/listings', {
        method: 'POST',
        body: {
          donor_name: form.donor_name,
          donor_type: form.donor_type,
          address: form.address,
          area: form.area,
          item_name: form.item_name,
          food_type: form.food_type,
          quantity_kg: Number(form.quantity_kg),
          storage_type: form.storage_type,
          expiry_hours: Number(form.expiry_hours),
          agreed_to_regulations: true,
        },
      });
      if (data.success) {
        setResult(data);
      } else {
        setError(data.message ?? 'Something went wrong — please check your details and try again.');
        if (data.food_safety_check?.verdict === 'bad') setRejectionCheck(data.food_safety_check);
      }
    } catch (err) {
      if (err instanceof FetchError) {
        const body = err.body as { message?: string; food_safety_check?: FoodSafetyCheckResult } | null;
        setError(body?.message ?? err.message ?? 'Something went wrong — please check your details and try again.');
        if (body?.food_safety_check?.verdict === 'bad') setRejectionCheck(body.food_safety_check);
      } else {
        setError('Network error — please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <PublicShell>
        <GlassCard className="p-6 flex flex-col items-center text-center gap-3">
          <div
            className="flex items-center justify-center rounded-xl"
            style={{ width: 44, height: 44, background: 'var(--success)' }}
          >
            <CheckCircle2 size={22} color="#fff" />
          </div>
          <h1 className="text-title-1">Listing submitted</h1>
          <p className="text-body" style={{ color: 'var(--text-secondary)' }}>
            {result.suggested_branch
              ? (
                <>
                  Suggested branch: <strong style={{ color: 'var(--text-primary)' }}>{result.suggested_branch}</strong>.
                  A Willing Hearts staff member will review and approve this before it&apos;s finalized.
                </>
              )
              : (result.message ?? 'A Willing Hearts staff member will review this shortly.')}
          </p>
          <div className="flex items-center gap-1.5 text-caption" style={{ color: 'var(--monitor)' }}>
            <Clock3 size={13} />
            Awaiting NGO approval
          </div>
          {result.food_safety_check && (
            <div style={{ width: '100%', textAlign: 'left' }}>
              <FoodSafetyBadge check={result.food_safety_check} />
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary mt-2"
            onClick={() => {
              setForm(initialForm);
              setResult(null);
            }}
          >
            Submit another listing
          </button>
        </GlassCard>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="flex flex-col items-center text-center gap-2 mb-8">
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 44, height: 44, background: 'var(--accent)' }}
        >
          <HandHeart size={22} color="#fff" />
        </div>
        <h1 className="text-title-1">Donate Surplus Food</h1>
        <p className="text-body" style={{ color: 'var(--text-secondary)', maxWidth: 460 }}>
          Hotels, restaurants, supermarkets and factories can post surplus food here. Every listing is
          reviewed and approved by Willing Hearts staff before it&apos;s routed to a branch.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <GlassCard className="p-5 flex flex-col gap-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label className="form-label" htmlFor="donor_name">
                Business name
              </label>
              <input
                id="donor_name"
                className="input"
                required
                placeholder="e.g. Golden Spoon Bakery"
                value={form.donor_name}
                onChange={(e) => update('donor_name', e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="donor_type">
                Business type
              </label>
              <select
                id="donor_type"
                className="input"
                value={form.donor_type}
                onChange={(e) => update('donor_type', e.target.value as (typeof DONOR_TYPES)[number])}
              >
                {DONOR_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="address">
              Pickup address
            </label>
            <input
              id="address"
              className="input"
              required
              placeholder="Street address for pickup"
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="area">
              Nearest area <span style={{ color: 'var(--text-tertiary)' }}>(used for routing)</span>
            </label>
            <select id="area" className="input" value={form.area} onChange={(e) => update('area', e.target.value as AreaValue)}>
              {SG_AREAS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ borderTop: '0.5px solid var(--border-default)' }} />

          <div>
            <label className="form-label" htmlFor="item_name">
              What food is it?
            </label>
            <input
              id="item_name"
              className="input"
              required
              placeholder="e.g. Sourdough loaves, 40 pieces"
              value={form.item_name}
              onChange={(e) => update('item_name', e.target.value)}
            />
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label className="form-label" htmlFor="food_type">
                Food type
              </label>
              <select
                id="food_type"
                className="input capitalize"
                value={form.food_type}
                onChange={(e) => update('food_type', e.target.value as (typeof FOOD_TYPES)[number])}
              >
                {FOOD_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="storage_type">
                Storage
              </label>
              <select
                id="storage_type"
                className="input capitalize"
                value={form.storage_type}
                onChange={(e) => update('storage_type', e.target.value as (typeof STORAGE_TYPES)[number])}
              >
                {STORAGE_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label className="form-label" htmlFor="quantity_kg">
                Quantity (kg)
              </label>
              <input
                id="quantity_kg"
                className="input"
                type="number"
                min="0.1"
                step="0.1"
                required
                placeholder="e.g. 25"
                value={form.quantity_kg}
                onChange={(e) => update('quantity_kg', e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="expiry_hours">
                Spoils in how many hours?
              </label>
              <input
                id="expiry_hours"
                className="input"
                type="number"
                min="1"
                step="1"
                required
                placeholder="e.g. 6"
                value={form.expiry_hours}
                onChange={(e) => update('expiry_hours', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="note">
              Anything else to note? <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span>
            </label>
            <textarea
              id="note"
              className="input"
              rows={2}
              maxLength={500}
              placeholder="e.g. it's been sitting out since lunch service, about 2 hours ago"
              value={form.note}
              onChange={(e) => update('note', e.target.value)}
            />
          </div>

          <div className="flex items-start gap-2 text-caption" style={{ color: 'var(--text-tertiary)' }}>
            <ShieldCheck size={13} style={{ marginTop: 1, flexShrink: 0 }} />
            Every submission is checked instantly against a standardized food-safety reference — perishability,
            safe storage temperature, and minimum safe hours by food category. Clearly unsafe items are declined
            automatically; borderline ones still reach a staff member, flagged for a closer look.
          </div>

          {rejectionCheck && <FoodSafetyBadge check={rejectionCheck} />}

          <div style={{ borderTop: '0.5px solid var(--border-default)' }} />

          <div className="glass-card-nested p-4 flex flex-col gap-3">
            <span className="text-overline">Donation guidelines</span>
            <p className="text-caption">
              By submitting, you confirm: the food is safe and fit for human consumption at the time of
              pickup; the quantity and expiry you&apos;ve entered are accurate to the best of your knowledge;
              you won&apos;t charge Willing Hearts or recipients for this donation; and you&apos;ll make the item
              available for pickup at the address given until a Willing Hearts branch collects it or the
              listing is withdrawn.
            </p>
            <label className="flex items-start gap-2 text-caption" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                required
                checked={form.agreed_to_regulations}
                onChange={(e) => update('agreed_to_regulations', e.target.checked)}
                style={{ marginTop: 2 }}
              />
              I confirm the above and agree to Bitewise&apos;s food donation guidelines.
            </label>
          </div>

          {error && !rejectionCheck && (
            <p className="text-caption" role="alert" aria-live="assertive" style={{ color: 'var(--critical)' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!form.agreed_to_regulations || submitting}
            aria-busy={submitting}
            aria-label={submitting ? 'Submitting donation listing, please wait…' : 'Submit listing for NGO approval'}
          >
            {submitting ? 'Submitting…' : 'Submit for NGO approval'}
          </button>
        </GlassCard>
      </form>
    </PublicShell>
  );
}
