import { hasKey, intlLocale, t, type Locale } from '@/src/i18n';
import { formatQtyLocale, parseDbQty } from '@/src/lib/qty';

/** Display only: keep decimal strings exact and never change submitted quantities. */
export function quantityLabel(value: string | null | undefined, unit: string | null | undefined, locale: Locale): string {
  if (value == null) return locale === 'id' ? 'Jumlah belum diketahui' : 'Quantity unknown';
  const unitLabel = unit ? codeLabel(unit, locale) : (locale === 'id' ? '(satuan belum diketahui)' : '(unit unknown)');
  return `${formatQtyLocale(parseDbQty(value), intlLocale(locale))} ${unitLabel}`;
}

export function codeLabel(code: string, locale: Locale): string {
  if (hasKey('ops', `labels.${code}`, locale)) return t('ops', `labels.${code}`, undefined, locale);
  if (hasKey('direct', `state.${code}`, locale)) return t('direct', `state.${code}`, undefined, locale);
  return code.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
}

export function statusTone(code: string): 'neutral' | 'success' | 'attention' | 'danger' {
  if (['SAFETY_DEADLINE_PASSED', 'RECALLED', 'EXPIRED', 'REJECTED_FINAL', 'SEND_FAILED', 'EXCEPTION', 'REJECTED'].includes(code)) return 'danger';
  if (['HOLD', 'QUARANTINE', 'NEEDS_CLARIFICATION', 'NEEDS_INFO', 'AWAITING_APPROVAL', 'AWAITING_FINAL_APPROVAL', 'DELIVERY_UNKNOWN', 'HUMAN', 'REVIEW_REQUIRED'].includes(code)) return 'attention';
  if (['APPROVED', 'RECEIVED', 'ADEQUATE', 'ACCEPTED', 'CLOSED', 'READY'].includes(code)) return 'success';
  return 'neutral';
}

/** A display warning based on the tenant clock, not a replacement for release validation. */
export function stockStatus(batch: { restriction: string; expires_at: string | null; handling_deadline: string | null }, now: string): string {
  if (batch.restriction !== 'NONE') return batch.restriction;
  const clock = Date.parse(now);
  return [batch.expires_at, batch.handling_deadline].some(value => value != null && Date.parse(value) <= clock)
    ? 'SAFETY_DEADLINE_PASSED' : 'NONE';
}
