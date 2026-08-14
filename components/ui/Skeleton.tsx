import type { CSSProperties, ReactNode } from 'react';

export function Skeleton({
  height = 14,
  width = '100%',
  radius = 8,
  style,
}: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius, ...style }} />;
}

/** Placeholder that mirrors the shape of a real card, so the page doesn't
 *  jump when content arrives. */
export function SkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`glass-card p-5 flex flex-col gap-3 ${className}`}>
      <Skeleton height={16} width="45%" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '65%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 3, lines = 3 }: { count?: number; lines?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

/** Consistent, designed empty state — replaces bare "No items" text. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col items-center text-center gap-2 px-6 py-12">
      {icon && (
        <div
          className="flex items-center justify-center rounded-xl mb-1"
          style={{ width: 40, height: 40, background: 'var(--bg-elevated)' }}
        >
          {icon}
        </div>
      )}
      <span className="text-title-2">{title}</span>
      {description && (
        <p className="text-body" style={{ color: 'var(--text-secondary)', maxWidth: 380 }}>
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
