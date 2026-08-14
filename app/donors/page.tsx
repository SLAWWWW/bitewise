'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { DonorCard } from '@/components/donor/DonorCard';
import { DonorProfile } from '@/components/donor/DonorProfile';
import { SkeletonCard, EmptyState } from '@/components/ui/Skeleton';
import { fetchJson } from '@/lib/utils/fetch-json';
import type { Donor } from '@/lib/types';

export default function DonorsPage() {
  const [donors, setDonors] = useState<Donor[]>([]);
  const [selected, setSelected] = useState<Donor | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<{ donors: Donor[] }>('/api/donors')
      .then((data) => setDonors(data.donors ?? []))
      .catch(() => {/* keep empty list on error */})
      .finally(() => setLoading(false));
  }, []);

  const totalKg = donors.reduce((sum, d) => sum + (d.total_kg_donated ?? 0), 0);

  return (
    <AppShell
      title="Donor Relationships"
      subtitle={
        loading
          ? 'Every business contributing to Willing Hearts.'
          : `${donors.length} businesses · ${totalKg.toLocaleString('en-SG')}kg contributed all-time.`
      }
    >
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {loading && Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
        {!loading &&
          donors.map((donor) => (
            <DonorCard key={donor.id} donor={donor} onClick={() => setSelected(donor)} />
          ))}
      </div>

      {!loading && donors.length === 0 && (
        <EmptyState
          icon={<Users size={19} color="var(--text-tertiary)" />}
          title="No donors yet"
          description="Businesses appear here automatically the first time they submit a donation through the public form."
        />
      )}

      {selected && <DonorProfile donor={selected} onClose={() => setSelected(null)} />}
    </AppShell>
  );
}
