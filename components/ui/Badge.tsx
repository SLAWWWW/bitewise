import type { ReactNode } from 'react';

export type BadgeVariant =
  | 'stable'
  | 'monitor'
  | 'urgent'
  | 'critical'
  | 'neutral'
  | 'info'
  | 'accent';

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  stable: 'badge-stable',
  monitor: 'badge-monitor',
  urgent: 'badge-urgent',
  critical: 'badge-critical',
  neutral: 'badge-neutral',
  info: 'badge-info',
  accent: 'badge-accent',
};

export function Badge({
  variant = 'neutral',
  children,
  icon,
  title,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge ${VARIANT_CLASS[variant]}`} title={title}>
      {icon}
      {children}
    </span>
  );
}
