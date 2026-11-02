import { formatQtyLocale, parseDbQty, type Qty } from '@/src/lib/qty';
import { intlLocale, t, type Locale } from '@/src/i18n';

/**
 * A quantity always shown with its unit: "40,5 kg". `value` is the DB/wire decimal
 * string (or a bigint milli-unit Qty). Exact — never converted through floats.
 */
export function UnitQty({
  value,
  unit,
  locale = 'id',
  unitLabel,
  className,
}: {
  value: string | Qty | null | undefined;
  unit: string;
  locale?: Locale;
  /** Display label for the unit (e.g. translated); defaults to the unit code. */
  unitLabel?: string;
  className?: string;
}) {
  if (value === null || value === undefined || value === '') {
    return <span className={className}>— {unitLabel ?? unit}</span>;
  }
  const q = typeof value === 'bigint' ? value : parseDbQty(value);
  return (
    <span className={`tnum ${className ?? ''}`.trim()} data-unit={unit}>
      {formatQtyLocale(q, intlLocale(locale))}&nbsp;{unitLabel ?? unit}
    </span>
  );
}

export interface QtyItem {
  qty: string | Qty;
  unit: string;
}

/** Sum quantities per unit. Different units are kept apart, never added together. */
export function sumByUnit(items: readonly QtyItem[]): { unit: string; qty: Qty }[] {
  const totals = new Map<string, Qty>();
  for (const it of items) {
    const q = typeof it.qty === 'bigint' ? it.qty : parseDbQty(it.qty);
    totals.set(it.unit, (totals.get(it.unit) ?? 0n) + q);
  }
  return [...totals.entries()].map(([unit, qty]) => ({ unit, qty }));
}

/** Totals per unit, e.g. "120 portion · 35,5 kg" — with a note when units differ. */
export function UnitQtyTotals({ items, locale = 'id' }: { items: readonly QtyItem[]; locale?: Locale }) {
  const totals = sumByUnit(items);
  if (totals.length === 0) return <span>—</span>;
  return (
    <span className="lb-qty-totals">
      {totals.map((x, i) => (
        <span key={x.unit}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <UnitQty value={x.qty} unit={x.unit} locale={locale} />
        </span>
      ))}
      {totals.length > 1 && <span className="lb-qty-note">{t('common', 'qty.incomparable', undefined, locale)}</span>}
    </span>
  );
}
