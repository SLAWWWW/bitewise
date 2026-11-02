/**
 * Directory filter panel: a plain GET form (works without JavaScript, URL is shareable
 * and drives the server-rendered list). Server- and client-safe.
 */
import Link from 'next/link';
import { t, type Locale } from '@/src/i18n';
import {
  AGREEMENT_SUMMARY_STATUSES,
  AREAS,
  FLO_STATUSES,
  FLO_TYPES,
  NEED_BANDS,
  RESPONSE_BANDS,
  type FloListFilters,
} from '@/src/application/flo/schemas';
import type { ClusterRef } from '@/src/application/flo/queries';

export function FloFilters({
  filters,
  clusters,
  locale,
}: {
  filters: FloListFilters;
  clusters: ClusterRef[];
  locale: Locale;
}) {
  const tf = (k: string) => t('flo', k, undefined, locale);
  const select = (name: keyof FloListFilters, label: string, options: readonly string[], labelOf: (v: string) => string) => (
    <div className="lb-field min-w-0">
      <label className="form-label" htmlFor={`f-${name}`}>
        {label}
      </label>
      <select id={`f-${name}`} name={name} className="input" defaultValue={(filters[name] as string | undefined) ?? ''}>
        <option value="">{tf('filter.any')}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labelOf(o)}
          </option>
        ))}
      </select>
    </div>
  );
  const active = Object.values(filters).some((v) => v !== undefined && v !== '');

  return (
    <form method="get" action="/flo" className="glass-card p-4 flex flex-col gap-3 min-w-0" role="search" aria-label={tf('filter.title')}>
      <div className="lb-field min-w-0">
        <label className="form-label" htmlFor="f-q">
          {tf('filter.q')}
        </label>
        <input id="f-q" name="q" className="input" defaultValue={filters.q ?? ''} placeholder={tf('filter.qPlaceholder')} maxLength={100} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {select('area', tf('filter.area'), AREAS, (v) => tf(`area.${v}`))}
        <div className="lb-field min-w-0">
          <label className="form-label" htmlFor="f-cluster">
            {tf('filter.cluster')}
          </label>
          <select id="f-cluster" name="cluster" className="input" defaultValue={filters.cluster ?? ''}>
            <option value="">{tf('filter.any')}</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {tf(`area.${c.area}`)}
              </option>
            ))}
          </select>
        </div>
        {select('type', tf('filter.type'), FLO_TYPES, (v) => tf(`type.${v}`))}
        {select('status', tf('filter.status'), FLO_STATUSES, (v) => tf(`status.${v}`))}
        {select('agreement', tf('filter.agreement'), AGREEMENT_SUMMARY_STATUSES, (v) => tf(`agreement.${v}`))}
        {select('need', tf('filter.need'), NEED_BANDS, (v) => tf(`needBand.${v}`))}
        {select('response', tf('filter.response'), RESPONSE_BANDS, (v) => tf(`respBand.${v}`))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary">
          {tf('filter.apply')}
        </button>
        {active && (
          <Link href="/flo" className="btn btn-ghost">
            {tf('filter.reset')}
          </Link>
        )}
      </div>
    </form>
  );
}
