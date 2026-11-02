import type { ReactNode } from 'react';
import Link from 'next/link';
import { t, type Locale } from '@/src/i18n';
import { EmptyState } from './EmptyState';

export interface Column<R> {
  key: string;
  header: string;
  cell: (row: R) => ReactNode;
  align?: 'start' | 'end' | 'center';
  /** 'primary' = card title on mobile and the row link target. One column should be primary. */
  priority?: 'primary' | 'secondary';
  /** Hide on the mobile card view. */
  hideOnMobile?: boolean;
  width?: string;
}

/**
 * Accessible data table (server- and client-safe, no hooks):
 *  - desktop: labelled, focusable horizontal scroll container (no page-level scroll),
 *  - < 720px: stacked cards with label/value pairs,
 *  - rows link to their detail page through a real <a> in the primary cell (keyboard
 *    and screen-reader friendly); the whole row is clickable via a stretched link,
 *  - loading and empty states.
 */
export function DataTable<R>({
  caption,
  columns,
  rows,
  rowKey,
  rowHref,
  rowLabel,
  loading = false,
  empty,
  locale = 'id',
  captionHidden = true,
  footer,
}: {
  /** Accessible name of the table / scroll region. */
  caption: string;
  columns: readonly Column<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  rowHref?: (row: R) => string | null | undefined;
  /** Text for the row link (defaults to the row key). */
  rowLabel?: (row: R) => string;
  loading?: boolean;
  empty?: ReactNode;
  locale?: Locale;
  captionHidden?: boolean;
  footer?: ReactNode;
}) {
  const tc = (k: string, v?: Record<string, string | number>) => t('common', k, v, locale);
  const primary = columns.find((c) => c.priority === 'primary') ?? columns[0];

  if (loading) {
    return (
      <div className="lb-table-loading" role="status" aria-live="polite" aria-busy="true">
        <span className="skeleton" style={{ display: 'block', height: 14, width: '40%' }} />
        <span className="skeleton" style={{ display: 'block', height: 14, width: '70%' }} />
        <span className="skeleton" style={{ display: 'block', height: 14, width: '55%' }} />
        <span className="sr-only">{tc('state.loading')}</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return <>{empty ?? <EmptyState locale={locale} />}</>;
  }

  const linkFor = (row: R, content: ReactNode, stretched: boolean) => {
    const href = rowHref?.(row);
    if (!href) return content;
    const label = rowLabel?.(row);
    return (
      <Link
        href={href}
        className={stretched ? 'lb-row-link' : 'lb-card-link'}
        aria-label={label ? tc('table.openRow', { label }) : undefined}
      >
        {content}
      </Link>
    );
  };

  const alignClass = (c: Column<R>) => (c.align === 'end' ? 'is-end' : c.align === 'center' ? 'is-center' : '');

  return (
    <div className="lb-datatable">
      <div className="lb-table-wrap" role="region" aria-label={caption} tabIndex={0}>
        <table className="lb-table">
          <caption className={captionHidden ? 'sr-only' : 'lb-table-caption'}>
            {caption}
          </caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={alignClass(c)} style={c.width ? { width: c.width } : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className={rowHref?.(row) ? 'is-linked' : undefined}>
                {columns.map((c) =>
                  c === primary ? (
                    <th key={c.key} scope="row" className={alignClass(c)}>
                      {linkFor(row, c.cell(row), true)}
                    </th>
                  ) : (
                    <td key={c.key} className={alignClass(c)}>
                      {c.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lb-table-hint text-caption" aria-hidden="true">
        {tc('table.scrollHint')}
      </p>

      <ul className="lb-cards" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="lb-card">
            <div className="lb-card-title">{linkFor(row, primary.cell(row), false)}</div>
            <dl className="lb-card-fields">
              {columns
                .filter((c) => c !== primary && !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="lb-card-field">
                    <dt>{c.header}</dt>
                    <dd>{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
      {footer && <div className="lb-table-footer">{footer}</div>}
    </div>
  );
}
