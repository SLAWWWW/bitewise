'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { SkeletonList, EmptyState } from '@/components/ui/Skeleton';
import { ApprovalCard } from '@/components/dashboard/ApprovalCard';
import { fetchJson } from '@/lib/utils/fetch-json';
import type { PendingListing } from '@/lib/types';

export default function ApprovalsPage() {
  const [listings, setListings] = useState<PendingListing[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApprovals = useCallback(async () => {
    try {
      const data = await fetchJson<{ listings: PendingListing[] }>('/api/approvals');
      setListings(data.listings ?? []);
    } catch {
      // Keep previous listings on transient poll error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 6000);
    return () => clearInterval(interval);
  }, [fetchApprovals]);

  return (
    <AppShell
      title="Pending Approvals"
      subtitle="Nothing reaches a branch until a staff member approves it here."
    >
      {loading && <SkeletonList count={2} lines={5} />}

      {!loading && listings.length === 0 && (
        <EmptyState
          icon={<Inbox size={19} color="var(--text-tertiary)" />}
          title="Queue is clear"
          description="Every incoming donation lands here for review. Submit one from the public donation form, or use Simulate on the Network Overview."
        />
      )}

      <div className="flex flex-col gap-4">
        {listings.map((listing) => (
          <ApprovalCard key={listing.id} listing={listing} onDecided={fetchApprovals} />
        ))}
      </div>
    </AppShell>
  );
}
