'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { DonorImpactPanel } from '@/components/donor/DonorImpactPanel';
import type { Donor } from '@/lib/types';

export function DonorProfile({ donor, onClose }: { donor: Donor; onClose: () => void }) {
  const meals = Math.round(donor.total_kg_donated * 2);
  const co2 = (donor.total_kg_donated * 2.5).toFixed(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Capture the element that triggered the dialog so we can return focus on close.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Record which element had focus before we steal it; restore it on unmount.
    previousFocusRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    // The backdrop is purely decorative (dim scrim). aria-hidden is NOT placed
    // here — that would hide the role="dialog" child from screen readers.
    // The click handler closes the modal when the user clicks outside the card.
    <div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.6)', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Donor profile for ${donor.name}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <GlassCard
          className="p-6 flex flex-col gap-5"
          style={{ maxWidth: 440, width: '100%', background: 'var(--bg-elevated)' }}
        >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-title-1">{donor.name}</span>
            <span className="text-caption capitalize">
              {donor.type} · {donor.address ?? 'Singapore'}
            </span>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label={`Close ${donor.name} profile`}
            className="flex items-center justify-center rounded-lg"
            style={{ width: 28, height: 28, background: 'var(--bg-hover)' }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="flex gap-2">
          <Badge variant="accent">{donor.status}</Badge>
          <Badge variant="stable">{(donor.reliability_score * 100).toFixed(0)}% reliability</Badge>
        </div>

        <div className="glass-card-nested p-4">
          <p className="text-body">
            <strong>{donor.name}</strong> has donated{' '}
            <strong>{donor.total_kg_donated.toLocaleString('en-SG')}kg</strong> to Willing Hearts,
            equivalent to approximately <strong>{meals.toLocaleString('en-SG')} meals</strong> and{' '}
            <strong>{co2}kg of CO₂ avoided</strong>.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="glass-card-nested p-3 flex flex-col gap-1">
            <span className="text-overline">Meals Equivalent</span>
            <span className="text-title-1 tnum">{meals.toLocaleString('en-SG')}</span>
          </div>
          <div className="glass-card-nested p-3 flex flex-col gap-1">
            <span className="text-overline">CO₂ Avoided</span>
            <span className="text-title-1 tnum">{co2}kg</span>
          </div>
        </div>

        <DonorImpactPanel donorId={donor.id} />
        </GlassCard>
      </div>
    </div>
  );
}
