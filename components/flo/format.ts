/** Formatting helpers for the FLO pages (server- and client-safe, explicit locale). */
import { intlLocale, type Locale } from '@/src/i18n';
import { formatLocalDate } from '@/src/lib/tz';

/** A derived 0..1 factor shown with two decimals in the UI locale ("0,70" / "0.70"). */
export function fmt2(value: number, locale: Locale): string {
  const rounded = Math.round(Number(value.toPrecision(12)) * 100) / 100;
  return new Intl.NumberFormat(intlLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rounded);
}

/** A DB numeric string ("90.00") shown in the UI locale without float drift beyond 2 dp. */
export function fmtNumeric(value: string | null | undefined, locale: Locale, maxFraction = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: maxFraction }).format(n);
}

/** Local legal date (YYYY-MM-DD, tenant zone) labelled WIB, never shifted through a time zone. */
export function legalDate(date: string | null | undefined, locale: Locale, withLabel = true): string {
  if (!date) return '—';
  const text = formatLocalDate(date, locale);
  return withLabel ? `${text} (WIB)` : text;
}

/** Whole days between two instants, floored (UI display only; `now` is the tenant clock). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}
