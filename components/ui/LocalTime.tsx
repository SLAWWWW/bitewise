import { DEFAULT_TZ, formatRelative, formatWib, type FormatOptions } from '@/src/lib/tz';
import type { Locale } from '@/src/i18n';

/**
 * An instant rendered with an explicit time zone and its label ("26 Okt 2026 08.00
 * WIB"). Identical output on server and client (no hydration mismatch). Pass
 * `relativeTo` (the tenant clock, never the browser clock) to append "(dalam 2 jam)".
 */
export function LocalTime({
  value,
  tz = DEFAULT_TZ,
  locale = 'id',
  style = 'datetime',
  seconds,
  relativeTo,
  className,
}: {
  value: Date | string | null | undefined;
  tz?: string;
  locale?: Locale;
  style?: FormatOptions['style'];
  seconds?: boolean;
  relativeTo?: Date | string;
  className?: string;
}) {
  if (value === null || value === undefined || value === '') {
    return <span className={className}>—</span>;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return <span className={className}>—</span>;
  const text = formatWib(d, { locale, tz, style, seconds });
  return (
    <time dateTime={d.toISOString()} className={className}>
      {text}
      {relativeTo !== undefined && <span className="lb-time-rel"> ({formatRelative(d, relativeTo, locale)})</span>}
    </time>
  );
}
