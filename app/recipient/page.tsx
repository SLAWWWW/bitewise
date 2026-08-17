'use client';

import { useCallback, useEffect, useState } from 'react';
import { Utensils, UserRound } from 'lucide-react';
import { PublicShell } from '@/components/layout/PublicShell';
import { FoodCard } from '@/components/recipient/FoodCard';
import { ProfileModal } from '@/components/recipient/ProfileModal';
import { SkeletonList, EmptyState } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { fetchJson, FetchError } from '@/lib/utils/fetch-json';
import type { ClaimResponse, CreateProfileResponse, PublicFoodItem, RecipientProfile } from '@/lib/types';

const PROFILE_KEY = 'bitewise_recipient_profile';
const CLAIMED_ITEMS_KEY = 'bitewise_claimed_items';

function getStoredProfile(): RecipientProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as RecipientProfile) : null;
  } catch {
    return null;
  }
}

function storeProfile(profile: RecipientProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

// Claiming used to be marked only in React state — a refresh lost it, and
// since the server-side status had already flipped to 'reserved', the item
// then vanished from the in_stock-only list with zero trace it was ever
// claimed. Persisting the id set is what lets "you claimed this" survive a
// reload instead of just disappearing.
function getPersistedClaimedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(CLAIMED_ITEMS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistClaimedIds(ids: Set<string>) {
  localStorage.setItem(CLAIMED_ITEMS_KEY, JSON.stringify([...ids]));
}

export default function RecipientPage() {
  const [items, setItems] = useState<PublicFoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<RecipientProfile | null>(null);
  const [pendingClaim, setPendingClaim] = useState<PublicFoodItem | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const toast = useToast();

  const fetchInventory = useCallback(() => {
    // Re-read on every call rather than closing over a stale set — a claim
    // made just now, or a pickup confirmed by staff on another device, both
    // need to show up without requiring a manual page reload.
    const claimed = getPersistedClaimedIds();
    return fetchJson<{ items: PublicFoodItem[] }>('/api/inventory')
      .then((data) => {
        // Reserved / escalated stock isn't offered to new claimants — but an
        // item THIS browser already claimed stays visible (marked as such)
        // regardless of its status, instead of silently vanishing once it's
        // no longer 'in_stock'.
        setItems(
          (data.items ?? []).filter(
            (item: PublicFoodItem) => item.status === 'in_stock' || claimed.has(item.id)
          )
        );
        setClaimedIds(claimed);
      })
      .catch(() => {/* keep previous items on transient error */});
  }, []);

  useEffect(() => {
    // localStorage is only available client-side, so this can't be a useState initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(getStoredProfile());
    fetchInventory().finally(() => setLoading(false));
    const interval = setInterval(fetchInventory, 15000);
    return () => clearInterval(interval);
  }, [fetchInventory]);

  async function performClaim(item: PublicFoodItem, profileId: string) {
    setClaimingId(item.id);
    try {
      const data = await fetchJson<ClaimResponse>('/api/claims', {
        method: 'POST',
        body: { inventory_item_id: item.id, profile_id: profileId },
      });
      if (data.success) {
        setClaimedIds((prev) => {
          const next = new Set(prev).add(item.id);
          persistClaimedIds(next);
          return next;
        });
        toast(
          'success',
          data.pickup_window_minutes
            ? `Reserved ${item.item_name} — ${data.pickup_window_minutes} min to collect from ${item.branch?.name ?? 'the branch'}.`
            : `Reserved ${item.item_name} — collect it from ${item.branch?.name ?? 'the branch'}.`
        );
      } else if (data.reason === 'active_claim_exists') {
        // The item itself is still available to everyone else — only this
        // recipient is blocked, so it must stay in the list, not disappear.
        toast('warning', data.message ?? 'You already have an active reservation.');
      } else {
        toast('warning', data.message ?? 'That item is no longer available.');
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }
    } catch (err) {
      if (err instanceof FetchError) {
        const body = err.body as ClaimResponse | null;
        if (body?.reason === 'active_claim_exists') {
          toast('warning', body.message ?? 'You already have an active reservation.');
        } else {
          toast('warning', body?.message ?? 'That item is no longer available.');
          setItems((prev) => prev.filter((i) => i.id !== item.id));
        }
      } else {
        toast('error', 'Network error — please try again.');
      }
    } finally {
      setClaimingId(null);
    }
  }

  function handleClaim(item: PublicFoodItem) {
    if (claimingId) return;
    if (profile) {
      performClaim(item, profile.id);
    } else {
      setPendingClaim(item);
    }
  }

  async function handleProfileSubmit(name: string, phone: string) {
    setCreatingProfile(true);
    // If profile creation fails server-side (migration 009 not applied yet),
    // fall back to a locally-generated identity rather than blocking the
    // claim entirely — this project's standing rule that a missing migration
    // degrades a feature, never blocks the person using the app.
    let resolvedProfile: RecipientProfile = {
      id: crypto.randomUUID(),
      name,
      phone: phone || null,
      created_at: new Date().toISOString(),
    };
    try {
      const data = await fetchJson<CreateProfileResponse>('/api/profiles', {
        method: 'POST',
        body: { name, phone: phone || undefined },
      });
      if (data.success && data.profile) resolvedProfile = data.profile;
    } catch {
      // Network error or missing table — resolvedProfile already has a
      // usable local fallback, so the claim can still proceed.
    } finally {
      setCreatingProfile(false);
    }

    storeProfile(resolvedProfile);
    setProfile(resolvedProfile);
    const item = pendingClaim;
    setPendingClaim(null);
    if (item) await performClaim(item, resolvedProfile.id);
  }

  return (
    <PublicShell wide>
      <div className="flex flex-col items-center text-center gap-2 mb-8">
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 44, height: 44, background: 'var(--accent)' }}
        >
          <Utensils size={22} color="#fff" />
        </div>
        <h1 className="text-title-1">Available Near You</h1>
        <p className="text-body" style={{ color: 'var(--text-secondary)', maxWidth: 420 }}>
          Free surplus food from Willing Hearts branches across Singapore. Browse anonymously — no
          login, ever. Claiming just needs your name, so the branch knows who&apos;s collecting.
        </p>
        <div className="flex items-center gap-1.5 text-caption" style={{ color: 'var(--success)' }}>
          <UserRound size={13} />
          No account or password — a name is all a claim ever asks for
        </div>
      </div>

      {loading && <SkeletonList count={3} lines={2} />}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={<Utensils size={19} color="var(--text-tertiary)" />}
          title="Nothing available right now"
          description="Food appears here as soon as Willing Hearts branches receive and log new stock. Check back shortly."
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 items-start">
        {items.map((item) => (
          <FoodCard
            key={item.id}
            item={item}
            onClaim={() => handleClaim(item)}
            claiming={claimingId === item.id}
            claimed={claimedIds.has(item.id)}
          />
        ))}
      </div>

      {pendingClaim && (
        <ProfileModal
          onSubmit={handleProfileSubmit}
          onCancel={() => setPendingClaim(null)}
          submitting={creatingProfile}
        />
      )}
    </PublicShell>
  );
}
