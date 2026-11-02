import { LogIn } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { isDemoLike } from '@/src/config/env';
import { isDomainError } from '@/src/db/errors';
import { roleLabel, t, type Locale } from '@/src/i18n';
import { getLocale } from '@/src/i18n/server';
import { getServerActor, listDemoLogins, type DemoLoginEntry } from '@/src/security/actor';
import { safeNextPath } from '@/src/security/redirect';
import { SignInButton } from './SignInButton';

export const metadata = { title: 'Masuk — Lumbung' };


export default async function MasukPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale: Locale = await getLocale();
  const tc = (k: string, v?: Record<string, string | number>) => t('common', k, v, locale);
  // Only strict same-origin paths are allowed as post-login targets (open-redirect guard).
  const next = safeNextPath((await searchParams).next);

  let body: React.ReactNode;
  if (!isDemoLike()) {
    body = <EmptyState title={tc('masuk.unavailable')} />;
  } else {
    let entries: DemoLoginEntry[] = [];
    let failed: string | null = null;
    let currentUserId: string | null = null;
    try {
      entries = await listDemoLogins();
      currentUserId = (await getServerActor().catch(() => null))?.userId ?? null;
    } catch (e) {
      // DB down, not migrated, or demo_login_directory() missing: all need the same setup steps.
      failed = tc('masuk.dbError');
      console.error('[lumbung] /masuk directory failed:', isDomainError(e) ? e.code : '', (e as Error).message);
    }
    if (failed) {
      body = <ErrorState title={tc('state.errorTitle')} message={failed} />;
    } else if (entries.length === 0) {
      body = <EmptyState title={tc('state.emptyTitle')} body={tc('masuk.noUsers')} />;
    } else {
      const byTenant = new Map<string, DemoLoginEntry[]>();
      for (const e of entries) {
        const list = byTenant.get(e.tenant_id) ?? [];
        list.push(e);
        byTenant.set(e.tenant_id, list);
      }
      body = [...byTenant.values()].map((list) => (
        <section key={list[0].tenant_id} className="lb-masuk-tenant" aria-labelledby={`tenant-${list[0].tenant_id}`}>
          <h2 id={`tenant-${list[0].tenant_id}`} className="text-overline">
            {tc('masuk.tenant')}: {list[0].tenant_name} · {tc(`mode.${list[0].tenant_mode}`)}
          </h2>
          <ul className="lb-masuk-list">
            {list.map((e) => (
              <li key={`${e.tenant_id}:${e.user_id}`}>
                <SignInButton
                  userId={e.user_id}
                  tenantId={e.tenant_id}
                  name={e.display_name}
                  role={roleLabel(e.role_label, locale)}
                  next={next}
                  current={e.user_id === currentUserId}
                />
              </li>
            ))}
          </ul>
        </section>
      ));
    }
  }

  return (
    <main className="lb-masuk">
      <div className="lb-masuk-card glass-card">
        <div className="flex items-center gap-3">
          <span className="lb-masuk-icon" aria-hidden="true">
            <LogIn size={18} />
          </span>
          <div>
            <h1 className="text-title-1">{tc('masuk.title')}</h1>
            <p className="text-body">{tc('masuk.subtitle')}</p>
          </div>
        </div>
        {isDemoLike() && (
          <p className="lb-mode-banner lb-mode-banner-inline" role="note">
            <span className="lb-mode-tag">{tc('mode.DEMO')}</span>
            <span>{tc('mode.banner.DEMO')}</span>
          </p>
        )}
        {body}
      </div>
    </main>
  );
}
