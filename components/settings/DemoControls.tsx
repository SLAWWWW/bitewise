'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FastForward, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useT } from '@/src/i18n/client';
import { fetchJson, FetchError } from '@/src/lib/fetch-json';

/**
 * Demo controls (PRD §16: "provide reset demo controls only to a demo administrator").
 *
 *  - Reset: rendered only for holders of demo.reset; disabled with a visible reason while
 *    the Stage-2 endpoint is absent ("tersedia di Tahap 2") or in LIVE.
 *  - Advance clock: holders of demo.clock; same availability rule.
 *
 * The server decides availability and capabilities; this component never infers them.
 * Mutations send an Idempotency-Key generated once per user intent and reused on retry.
 */
export function DemoControls({
  live,
  canReset,
  canClock,
  resetEndpoint,
  advanceEndpoint,
}: {
  live: boolean;
  canReset: boolean;
  canClock: boolean;
  /** URL when the endpoint exists, else null. */
  resetEndpoint: string | null;
  advanceEndpoint: string | null;
}) {
  const t = useT('settings');
  const router = useRouter();
  const [busy, setBusy] = useState<'reset' | 'advance' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const keys = useRef<{ reset?: string; advance?: string }>({});

  if (live) {
    return <p className="text-caption">{t('demo.liveHidden')}</p>;
  }

  async function run(which: 'reset' | 'advance') {
    const url = which === 'reset' ? resetEndpoint : advanceEndpoint;
    if (!url) return;
    if (which === 'reset' && !window.confirm(t('demo.resetConfirm'))) return;
    keys.current[which] ??= crypto.randomUUID();
    setBusy(which);
    setMessage(null);
    try {
      await fetchJson(url, {
        method: 'POST',
        headers: { 'Idempotency-Key': keys.current[which]! },
        body: which === 'advance' ? { minutes: 60 } : {},
        // A reset re-runs the full seed (seconds); advancing runs due jobs.
        timeoutMs: 120_000,
      });
      keys.current[which] = undefined;
      setMessage({ kind: 'ok', text: t(which === 'reset' ? 'demo.resetDone' : 'demo.advanceDone') });
      router.refresh();
    } catch (e) {
      const msg =
        e instanceof FetchError
          ? ((e.body as { error?: { message?: string } } | null)?.error?.message ?? e.message)
          : (e as Error).message;
      setMessage({ kind: 'error', text: t('demo.failed', { message: msg }) });
    } finally {
      setBusy(null);
    }
  }

  const stage2 = t('demo.reason.stage2');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          icon={<FastForward size={14} aria-hidden="true" />}
          loading={busy === 'advance'}
          disabledReason={!canClock ? t('demo.reason.noClockCap') : advanceEndpoint ? null : stage2}
          onClick={() => run('advance')}
        >
          {t('demo.advance')}
        </Button>
        {canReset && (
          <Button
            variant="danger"
            icon={<RotateCcw size={14} aria-hidden="true" />}
            loading={busy === 'reset'}
            disabledReason={resetEndpoint ? null : stage2}
            onClick={() => run('reset')}
          >
            {t('demo.reset')}
          </Button>
        )}
      </div>
      {!canReset && <p className="text-caption">{t('demo.onlyAdmin')}</p>}
      {message && (
        <p
          className="text-caption"
          role={message.kind === 'error' ? 'alert' : 'status'}
          style={{ color: message.kind === 'error' ? 'var(--critical)' : 'var(--success)' }}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
