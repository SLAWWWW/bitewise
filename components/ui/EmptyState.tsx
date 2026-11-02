import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { t, type Locale } from '@/src/i18n';

/** Empty-data state. Server- and client-safe (no hooks). */
export function EmptyState({
  title,
  body,
  action,
  icon,
  locale = 'id',
}: {
  title?: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  locale?: Locale;
}) {
  return (
    <div className="lb-state lb-state-empty" role="status">
      <span className="lb-state-icon" aria-hidden="true">
        {icon ?? <Inbox size={18} />}
      </span>
      <p className="lb-state-title">{title ?? t('common', 'state.emptyTitle', undefined, locale)}</p>
      {body && <div className="text-body">{body}</div>}
      {action && <div className="lb-state-action">{action}</div>}
    </div>
  );
}
