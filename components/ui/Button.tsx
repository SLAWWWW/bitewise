'use client';

import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/src/i18n/client';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/**
 * Button with an always-visible reason when disabled (PRD §16: "Disabled actions
 * must state why"; actions must not rely on hover — no tooltips). The reason is
 * rendered as text next to/below the button and linked via aria-describedby.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabledReason,
  reasonPlacement = 'below',
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  /** When set, the button is disabled and this text explains why. */
  disabledReason?: string | null;
  reasonPlacement?: 'below' | 'inline';
  icon?: ReactNode;
  children: ReactNode;
}) {
  const t = useT('common');
  const reasonId = useId();
  const isDisabled = !!disabled || !!disabledReason || loading;
  const describedBy = [rest['aria-describedby'], disabledReason ? reasonId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <span className={`lb-btn-wrap ${reasonPlacement === 'inline' ? 'is-inline' : ''}`}>
      <button
        {...rest}
        type={type}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-busy={loading || undefined}
        aria-describedby={describedBy}
        className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className ?? ''}`.trim()}
      >
        {loading ? <Loader2 size={14} className="lb-spin" aria-hidden="true" /> : icon}
        {children}
      </button>
      {disabledReason && (
        <span id={reasonId} className="lb-disabled-reason">
          {t('button.unavailable', { reason: disabledReason })}
        </span>
      )}
    </span>
  );
}
