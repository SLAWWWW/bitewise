'use client';

/**
 * Client-side command runner for the FLO pages (architecture F.2):
 *  - one Idempotency-Key (crypto.randomUUID()) per user intent, reused when the same
 *    request is retried (network error, double click) and replaced when the request
 *    changes or after success;
 *  - fetchJson with the Lumbung envelope; errors keep code + field_errors;
 *  - router.refresh() (or router.replace(navigateTo)) after success so Server Components
 *    re-read from the DB.
 */
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FetchError, FetchTimeoutError, fetchJson } from '@/src/lib/fetch-json';
import { hasKey } from '@/src/i18n';
import { useLocale, useT } from '@/src/i18n/client';

export interface CommandError {
  code: string;
  message: string;
  fieldErrors: Record<string, string[]>;
}

export interface CommandState<T> {
  pending: boolean;
  error: CommandError | null;
  result: T | null;
}

export function useCommand<T = unknown>() {
  const router = useRouter();
  const t = useT('flo');
  const locale = useLocale();
  const intent = useRef<{ key: string; signature: string } | null>(null);
  const [state, setState] = useState<CommandState<T>>({ pending: false, error: null, result: null });

  const run = useCallback(
    async (
      url: string,
      method: 'POST' | 'PATCH',
      body: unknown,
      opts: { navigateTo?: string; headers?: Record<string,string> } = {},
    ): Promise<T | null> => {
      const signature = `${method} ${url} ${JSON.stringify(body)}`;
      if (!intent.current || intent.current.signature !== signature) {
        intent.current = { key: crypto.randomUUID(), signature };
      }
      const key = intent.current.key;
      setState({ pending: true, error: null, result: null });
      try {
        const res = await fetchJson<{ data: T }>(url, {
          method,
          body,
          headers: { ...opts.headers, 'Idempotency-Key': key, 'x-correlation-id': `ui-${key}` },
        });
        intent.current = null;
        setState({ pending: false, error: null, result: res.data });
        // navigateTo: for actions whose own component disappears after the refresh
        // (e.g. approving the last pending version) — the page renders the notice.
        if (opts.navigateTo) router.replace(opts.navigateTo, { scroll: false });
        else router.refresh();
        return res.data;
      } catch (e) {
        let error: CommandError;
        if (e instanceof FetchError) {
          const code = e.code ?? `HTTP_${e.status}`;
          error = {
            code,
            message: hasKey('flo', `err.${code}`, locale) ? t(`err.${code}`) : t('err.generic', { message: e.message }),
            fieldErrors: e.fieldErrors ?? {},
          };
          // A definite rejection (4xx) will not change on retry with the same body.
          if (e.status >= 400 && e.status < 500 && code !== 'IDEMPOTENCY_IN_PROGRESS') intent.current = null;
        } else if (e instanceof FetchTimeoutError || e instanceof TypeError) {
          error = { code: 'NETWORK', message: t('err.network'), fieldErrors: {} };
        } else {
          error = { code: 'UNKNOWN', message: t('err.generic', { message: String(e) }), fieldErrors: {} };
        }
        setState({ pending: false, error, result: null });
        return null;
      }
    },
    [router, t, locale],
  );

  return { ...state, run };
}

/** Inline status line for a command (role=status for success, role=alert for errors). */
export function commandMessage(state: { error: CommandError | null }, success: string | null) {
  if (state.error) return { tone: 'error' as const, text: state.error.message };
  if (success) return { tone: 'ok' as const, text: success };
  return null;
}
