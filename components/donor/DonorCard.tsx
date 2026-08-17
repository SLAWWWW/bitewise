import { Store, Building2, UtensilsCrossed, Factory, Package } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { Donor } from '@/lib/types';

const TYPE_ICON: Record<Donor['type'], typeof Store> = {
  supermarket: Store,
  hotel: Building2,
  restaurant: UtensilsCrossed,
  factory: Factory,
  other: Package,
};

const TYPE_ACCENT: Record<Donor['type'], string> = {
  supermarket: 'var(--success)',
  hotel: 'var(--accent)',
  restaurant: 'var(--warning)',
  factory: 'var(--info)',
  other: 'var(--text-secondary)',
};

// A healthy reliability score isn't something staff need flagged — color is
// reserved for a score actually worth a second look before approving.
function reliabilityVariant(score: number) {
  if (score >= 0.75) return 'neutral' as const;
  if (score >= 0.5) return 'monitor' as const;
  return 'urgent' as const;
}

export function DonorCard({ donor, onClick }: { donor: Donor; onClick?: () => void }) {
  const Icon = TYPE_ICON[donor.type];
  const accent = TYPE_ACCENT[donor.type];

  return (
    <GlassCard
      className="flex flex-col gap-4 cursor-pointer"
      style={{ padding: '20px 22px', justifyContent: 'space-between' }}
      hover
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `View profile for ${donor.name}` : undefined}
      onKeyDown={
        onClick
          ? (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {/* Top row: icon + reliability badge */}
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{
            width: 38,
            height: 38,
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            border: `0.5px solid color-mix(in srgb, ${accent} 22%, transparent)`,
          }}
        >
          <Icon size={17} color={accent} strokeWidth={1.9} />
        </div>
        <div className="flex items-center">
          <Badge variant={reliabilityVariant(donor.reliability_score)}>
            {(donor.reliability_score * 100).toFixed(0)}% reliable
          </Badge>
          <InfoTooltip text="Set when the donor registers, not yet computed from delivery history (on-time drop-offs, no-shows) — a starting estimate, not a live behavioral score." />
        </div>
      </div>

      {/* Name + type */}
      <div className="flex flex-col gap-1.5">
        <span
          style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          {donor.name}
        </span>
        <Badge variant="neutral">
          <span className="capitalize">{donor.type}</span>
        </Badge>
      </div>

      {/* Stat: bottom editorial left-align — massive, tight */}
      <div className="flex flex-col mt-1">
        <span className="text-overline">Total donated</span>
        <span
          className="tnum"
          style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: 4 }}
        >
          {donor.total_kg_donated.toLocaleString('en-SG')}
          <span className="text-caption" style={{ fontWeight: 500, marginLeft: 3, fontSize: 12 }}>kg</span>
        </span>
      </div>
    </GlassCard>
  );
}
