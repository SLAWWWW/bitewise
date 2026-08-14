'use client';

import { useState } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import type { Donor, SubmitListingResponse, StorageType } from '@/lib/types';

const ITEM_NAMES: Record<string, string[]> = {
  bread: ['White Bread', 'Sourdough Loaves', 'Bagels'],
  cooked: ['Chicken Rice', 'Nasi Lemak', 'Fried Beehoon'],
  produce: ['Mixed Vegetables', 'Fresh Fruit Crates', 'Salad Greens'],
  canned: ['Canned Tuna', 'Canned Beans', 'Canned Soup'],
  dairy: ['Fresh Milk', 'Yoghurt Cups', 'Cheese Blocks'],
  beverage: ['Mineral Water', 'Fruit Juice', 'Soft Drinks'],
  grain: ['Jasmine Rice', 'Pasta', 'Rolled Oats'],
  other: ['Mixed Pantry Items', 'Snack Packs'],
};

const FOOD_TYPES = Object.keys(ITEM_NAMES);

const STORAGE_BY_TYPE: Record<string, StorageType> = {
  bread: 'ambient',
  cooked: 'cold',
  produce: 'cold',
  canned: 'ambient',
  dairy: 'cold',
  beverage: 'ambient',
  grain: 'ambient',
  other: 'ambient',
};

// [minHours, maxHours] until expiry — perishables skew short, shelf-stable items skew long
const EXPIRY_HOURS_BY_TYPE: Record<string, [number, number]> = {
  bread: [6, 30],
  cooked: [2, 6],
  produce: [4, 24],
  canned: [720, 8760],
  dairy: [2, 12],
  beverage: [720, 4320],
  grain: [720, 4320],
  other: [24, 72],
};

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface SimulateResult extends SubmitListingResponse {
  donor: Donor;
  foodType: string;
  quantityKg: number;
}

export function SimulateButton({
  donors,
  onSubmitted,
}: {
  donors: Donor[];
  onSubmitted: (result: SimulateResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSimulate() {
    if (donors.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const donor = randomItem(donors);
      const foodType = randomItem(FOOD_TYPES);
      const itemName = randomItem(ITEM_NAMES[foodType]);
      const quantityKg = randomInt(20, 80);
      const storageType = STORAGE_BY_TYPE[foodType];
      const [minH, maxH] = EXPIRY_HOURS_BY_TYPE[foodType];
      const expiryHours = randomInt(minH, maxH);

      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donor_id: donor.id,
          item_name: itemName,
          food_type: foodType,
          quantity_kg: quantityKg,
          storage_type: storageType,
          expiry_hours: expiryHours,
          agreed_to_regulations: true,
        }),
      });
      const data: SubmitListingResponse = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message ?? 'Could not submit this donation for review.');
      }
      onSubmitted({ ...data, donor, foodType, quantityKg });
    } catch {
      setError('Network error — could not reach the matching engine.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        className="btn btn-primary flex items-center justify-center gap-2"
        onClick={handleSimulate}
        disabled={loading || donors.length === 0}
        aria-busy={loading}
        aria-label={loading ? 'Submitting donation simulation, please wait…' : 'Simulate a new donation submission'}
      >
        {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Zap size={16} aria-hidden="true" />}
        {loading ? 'Submitting…' : 'Simulate New Donation'}
      </button>
      {error && (
        <span className="text-caption" style={{ color: 'var(--critical)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
