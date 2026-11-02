import type { ReactNode } from 'react';

/**
 * Page header. Pages under app/(ops) render this themselves (the shell is provided by
 * app/(ops)/layout.tsx). Stays visible at every width — the mobile top bar only shows
 * the brand.
 */
export function Header({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Small overline above the title (e.g. a breadcrumb or code). */
  eyebrow?: ReactNode;
}) {
  return (
    <div className="lb-page-header">
      <div className="flex flex-col gap-1.5 min-w-0">
        {eyebrow && <div className="text-overline">{eyebrow}</div>}
        <h1 className="lb-page-title">{title}</h1>
        {subtitle && <p className="text-body lb-page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="lb-page-actions">{action}</div>}
    </div>
  );
}
