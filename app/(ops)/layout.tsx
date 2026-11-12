import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState } from '@/components/ui/ErrorState';
import { isDomainError } from '@/src/db/errors';
import { roleLabel, t } from '@/src/i18n';
import { getLocale } from '@/src/i18n/server';
import { getServerActor, getTenantClock, type Actor } from '@/src/security/actor';
import { navForCapabilities } from '@/src/ui/nav';
import { getEnv } from '@/src/config/env';
import { prototypeGuideEnabled } from '@/src/config/prototype-guide';

/**
 * Authenticated operations area. proxy.ts only does an optimistic cookie check; the
 * real check is here (signature + ACTIVE membership loaded from the DB) and again in
 * every route handler / SQL command.
 */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  let actor: Actor | null;
  try {
    actor = await getServerActor();
  } catch (e) {
    const code = isDomainError(e) ? e.code : 'INTERNAL';
    return (
      <main className="lb-centered">
        <ErrorState
          title={t('common', 'state.errorTitle', undefined, locale)}
          message={t('common', code === 'DB_UNAVAILABLE' ? 'masuk.dbError' : 'state.errorBody', undefined, locale)}
        />
      </main>
    );
  }
  if (!actor) redirect('/masuk');

  const clock = await getTenantClock(actor);
  return (
    <AppShell
      nav={navForCapabilities(actor.capabilities, {
        prototypeGuide: prototypeGuideEnabled({ appMode: getEnv().APP_MODE, tenantMode: actor.tenantMode, flag: process.env.PROTOTYPE_GUIDE_ENABLED }),
      })}
      user={{
        displayName: actor.displayName,
        roleLabel: roleLabel(actor.roleLabel, locale),
        tenantName: actor.tenantName,
      }}
      mode={actor.tenantMode}
      clock={clock ? { ...clock, tz: actor.tenantTimezone } : null}
    >
      {children}
    </AppShell>
  );
}
