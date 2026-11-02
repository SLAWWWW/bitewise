'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { useT } from '@/src/i18n/client';
import { fetchJson, FetchError } from '@/src/lib/fetch-json';

export function SignInButton({
  userId,
  tenantId,
  name,
  role,
  next,
  current,
}: {
  userId: string;
  tenantId: string;
  name: string;
  role: string;
  next: string;
  current?: boolean;
}) {
  const t = useT('common');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson('/api/session', { method: 'POST', body: { user_id: userId, tenant_id: tenantId } });
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(t('masuk.failed', { message: e instanceof FetchError ? e.message : String((e as Error).message) }));
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className={`lb-masuk-user ${current ? 'is-current' : ''}`}
        onClick={signIn}
        disabled={busy}
        aria-label={t('masuk.choose', { name })}
        aria-describedby={error ? `signin-error-${userId}` : undefined}
      >
        <span className="flex flex-col items-start min-w-0">
          <span className="lb-masuk-name">{name}</span>
          <span className="text-caption">{role}</span>
        </span>
        <span className="ml-auto text-caption" aria-live="polite">
          {busy ? t('masuk.signingIn') : <ChevronRight size={16} aria-hidden="true" />}
        </span>
      </button>
      {error && (
        <p id={`signin-error-${userId}`} role="alert" className="lb-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
