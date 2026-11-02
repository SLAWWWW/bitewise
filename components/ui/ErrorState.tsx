'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useT } from '@/src/i18n/client';

/**
 * Error state with a retry. Default retry re-renders server data (router.refresh());
 * pass `retryHref` to navigate instead, or `onRetry` from a client parent.
 */
export function ErrorState({
  title,
  message,
  correlationId,
  retryHref,
  onRetry,
  retryLabel,
  hideRetry = false,
  children,
}: {
  title?: string;
  message?: ReactNode;
  correlationId?: string;
  retryHref?: string;
  onRetry?: () => void;
  retryLabel?: string;
  hideRetry?: boolean;
  children?: ReactNode;
}) {
  const t = useT('common');
  const router = useRouter();
  const label = retryLabel ?? t('action.retry');
  return (
    <div className="lb-state lb-state-error" role="alert">
      <span className="lb-state-icon" aria-hidden="true">
        <AlertTriangle size={18} />
      </span>
      <p className="lb-state-title">{title ?? t('state.errorTitle')}</p>
      <div className="text-body">{message ?? t('state.errorBody')}</div>
      {correlationId && <p className="text-caption mono">{t('state.correlation', { id: correlationId })}</p>}
      {children}
      {!hideRetry && (
        <div className="lb-state-action">
          {retryHref ? (
            <Link href={retryHref} className="btn btn-secondary">
              <RotateCw size={14} aria-hidden="true" />
              {label}
            </Link>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => (onRetry ? onRetry() : router.refresh())}>
              <RotateCw size={14} aria-hidden="true" />
              {label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
