import {AdminPanel} from '@/components/operations/AdminPanel';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { LocalTime } from '@/components/ui/LocalTime';
import { DemoControls } from '@/components/settings/DemoControls';
import { PolicyTable } from '@/components/settings/PolicyTable';
import { ReadinessChecklist } from '@/components/settings/ReadinessChecklist';
import { RuntimePanel } from '@/components/settings/RuntimePanel';
import { loadSettings, type SettingsSnapshot } from '@/src/application/settings/queries';
import { DEMO_ENDPOINTS, demoEndpointAvailable, runtimeInfo } from '@/src/application/settings/runtime';
import { isDemoLike } from '@/src/config/env';
import { isDomainError } from '@/src/db/errors';
import { withTx } from '@/src/db/tx';
import { makeT } from '@/src/i18n';
import { getLocale } from '@/src/i18n/server';
import { actorCtx, getServerActor } from '@/src/security/actor';
import { hasCap } from '@/src/security/capabilities';

export async function generateMetadata() {
  return { title: `${makeT('settings', await getLocale())('title')} · Lumbung` };
}

function SettingsSection({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass-card" style={{ padding: '20px 22px', minWidth: 0 }}>
      <h2 id={id} className="text-title-2">
        {title}
      </h2>
      {subtitle && (
        <p className="text-caption" style={{ marginTop: 4, marginBottom: 14 }}>
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

export default async function PengaturanPage() {
  const actor = await getServerActor();
  if (!actor) redirect('/masuk');
  const locale = await getLocale();
  const t = makeT('settings', locale);
  const tc = makeT('common', locale);
  const tz = actor.tenantTimezone;

  let snap: SettingsSnapshot;
  try {
    snap = await withTx(actorCtx(actor), (c) => loadSettings(c, actor.tenantMode));
  } catch (e) {
    console.error('[pengaturan] load failed', isDomainError(e) ? `${e.code}: ${(e.cause as Error | undefined)?.message ?? e.message}` : e);
    return (
      <>
        <Header title={t('title')} />
        <ErrorState title={t('error.title')} />
      </>
    );
  }

  const runtime = runtimeInfo();
  // Demo controls exist only for DEMO/TEST tenants in a DEMO/TEST process (F.14).
  const live = actor.tenantMode === 'LIVE' || !isDemoLike();
  const resetEndpoint = demoEndpointAvailable('reset') ? DEMO_ENDPOINTS.reset : null;
  const advanceEndpoint = demoEndpointAvailable('advanceClock') ? DEMO_ENDPOINTS.advanceClock : null;

  return (
    <div className="flex flex-col gap-5">
      <Header title={t('title')} subtitle={t('subtitle')} eyebrow={t('eyebrow', { tenant: actor.tenantName })} />

      <SettingsSection id="readiness" title={t('section.readiness')} subtitle={t('readiness.subtitle')}>
        <ReadinessChecklist
          decisions={snap.decisions}
          approvedCount={snap.approvedDecisionCount}
          tenantMode={actor.tenantMode}
          locale={locale}
          tz={tz}
        />
      </SettingsSection>

      <SettingsSection id="policies" title={t('section.policies')} subtitle={t('policies.subtitle')}>
        <PolicyTable policies={snap.policies} locale={locale} tz={tz} />
      </SettingsSection>

      <AdminPanel tx={fn=>withTx(actorCtx(actor),fn)} can={cap=>actor.capabilities.some(c=>c===cap)} locale={locale}/>

      <div className="grid-halves" style={{ alignItems: 'start' }}>
        <SettingsSection id="runtime" title={t('section.runtime')} subtitle={t('runtime.subtitle')}>
          <RuntimePanel runtime={runtime} tenantMode={actor.tenantMode} locale={locale} />
        </SettingsSection>

        <SettingsSection id="demo" title={t('section.demo')} subtitle={t('demo.subtitle')}>
          <dl className="flex flex-col gap-1" style={{ marginBottom: 14 }}>
            <dt className="text-overline">{t('demo.clock')}</dt>
            <dd className="text-title-2 tnum">
              {snap.now ? <LocalTime value={snap.now} tz={tz} locale={locale} /> : t('demo.clockUnavailable')}
            </dd>
            <dt className="text-overline" style={{ marginTop: 6 }}>
              {t('demo.clockMode')}
            </dt>
            <dd className="text-body">
              {snap.clockMode ? (
                <>
                  <span className="mono">{snap.clockMode}</span> — {tc(`clock.${snap.clockMode}`)}
                </>
              ) : (
                '—'
              )}
            </dd>
          </dl>
          <DemoControls
            live={live}
            canReset={hasCap(actor, 'demo.reset')}
            canClock={hasCap(actor, 'demo.clock')}
            resetEndpoint={resetEndpoint}
            advanceEndpoint={advanceEndpoint}
          />
        </SettingsSection>
      </div>
    </div>
  );
}
