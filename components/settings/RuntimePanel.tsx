import { makeT, type Locale } from '@/src/i18n';
import type { RuntimeInfo } from '@/src/application/settings/runtime';
import type { TenantMode } from '@/src/shared/enums';

/** Runtime mode + adapters in use (no secrets). Server-safe. */
export function RuntimePanel({
  runtime,
  tenantMode,
  locale,
}: {
  runtime: RuntimeInfo;
  tenantMode: TenantMode;
  locale: Locale;
}) {
  const t = makeT('settings', locale);
  const rows: { label: string; value: string; code: string; note?: string }[] = [
    { label: t('runtime.appMode'), code: runtime.appMode, value: t(`runtime.mode.${runtime.appMode}`) },
    { label: t('runtime.tenantMode'), code: tenantMode, value: t(`runtime.mode.${tenantMode}`) },
    {
      label: t('runtime.messaging'),
      code: runtime.messaging,
      value: t(`runtime.adapter.${runtime.messaging}`),
      note: runtime.messagingConfigured
        ? t('runtime.forced', { mode: runtime.appMode, configured: runtime.messagingConfigured })
        : undefined,
    },
    { label: t('runtime.routing'), code: runtime.routing, value: t(`runtime.adapter.${runtime.routing}`) },
    { label: t('runtime.llm'), code: runtime.llm, value: t(`runtime.adapter.${runtime.llm}`) },
    ...(runtime.llmModel ? [{ label: t('runtime.model'), code: runtime.llmModel, value: runtime.llmModel }] : []),
    { label: t('runtime.timezone'), code: runtime.timezone, value: runtime.timezone },
  ];
  return (
    <dl className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
          style={{ borderBottom: '1px solid var(--hair-soft)', paddingBottom: 8 }}
        >
          <dt className="text-caption">{r.label}</dt>
          <dd className="flex flex-col items-end text-right" style={{ minWidth: 0 }}>
            <span className="text-body">
              {r.value !== r.code && <span className="mono">{r.code}</span>}
              {r.value !== r.code && ' — '}
              {r.value}
            </span>
            {r.note && <span className="text-caption">{r.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
