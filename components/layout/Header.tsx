import type { ReactNode } from 'react';

export function Header({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 page-header">
      <div className="flex flex-col gap-1.5 min-w-0">
        {/* Hidden below the sidebar breakpoint — mobile top bar already shows this. */}
        <h1
          className="page-title"
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="text-body"
            style={{ maxWidth: 480 }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {action && (
        <div className="flex items-center gap-3 flex-shrink-0">
          {action}
        </div>
      )}
    </div>
  );
}
