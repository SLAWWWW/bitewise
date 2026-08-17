import type { ReactNode, CSSProperties, MouseEventHandler, KeyboardEventHandler } from 'react';

/**
 * GlassCard
 *
 * variant="default"  — standard glass surface (backdrop-blur + 5% white bg + glass-edge border)
 * variant="primary"  — flagship bento card, deeper shadow only (use once per view)
 * variant="nested"   — tighter inner card, no full blur (for cards inside cards)
 */
export function GlassCard({
  children,
  className = '',
  style,
  hover = false,
  variant = 'default',
  onClick,
  role,
  tabIndex,
  'aria-label': ariaLabel,
  onKeyDown,
  title,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  hover?: boolean;
  variant?: 'default' | 'primary' | 'nested';
  onClick?: MouseEventHandler<HTMLDivElement>;
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  title?: string;
}) {
  const base =
    variant === 'primary'
      ? 'glass-card-primary'
      : variant === 'nested'
        ? 'glass-card-nested'
        : 'glass-card';

  return (
    <div
      className={`${base} ${hover ? 'hover-lift' : ''} ${className}`}
      style={style}
      onClick={onClick}
      role={role}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      title={title}
    >
      {children}
    </div>
  );
}
