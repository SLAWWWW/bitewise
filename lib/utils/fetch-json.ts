/**
 * fetchJson — thin wrapper around the browser Fetch API.
 *
 * Enforces a consistent response contract for every API call in the app:
 *   - Cancels stale requests with an `AbortController` after `timeoutMs`
 *     (default 10 000ms) so the UI is never stuck in a loading state forever.
 *   - Throws a typed `FetchError` when the HTTP response is not 2xx so call
 *     sites can `catch` and inspect `.status` and `.body` instead of
 *     duplicating `if (!res.ok)` guards everywhere.
 *   - Throws `FetchTimeoutError` on a timeout so callers can distinguish it
 *     from a network-level failure when they need to.
 *   - Automatically sets `Content-Type: application/json` and serialises the
 *     body for POST/PATCH/PUT requests so callers never need to remember.
 *   - Returns a properly typed `T` — no more scattered `await res.json()` casts.
 *
 * Do NOT use this for SSE / EventSource streams — those are long-lived by
 * design and already manage their own AbortController.
 *
 * Usage:
 *   import { fetchJson, FetchError, FetchTimeoutError } from '@/lib/utils/fetch-json';
 *
 *   // GET
 *   const data = await fetchJson<FairnessResponse>('/api/fairness');
 *
 *   // POST with body
 *   const result = await fetchJson<SubmitListingResponse>('/api/listings', {
 *     method: 'POST',
 *     body: formData,
 *   });
 *
 *   // Error handling
 *   try {
 *     await fetchJson('/api/approvals/123/approve', { method: 'POST' });
 *   } catch (err) {
 *     if (err instanceof FetchTimeoutError) {
 *       // Show the same network-error message — no new UX.
 *     } else if (err instanceof FetchError) {
 *       console.error(err.status, err.body);
 *     }
 *   }
 */

export class FetchError extends Error {
  /** HTTP status code (e.g. 404, 409, 500). */
  readonly status: number;
  /** Parsed JSON body from the error response, or null if the body could not be parsed. */
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'FetchError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Thrown when a request is cancelled because it exceeded `timeoutMs`.
 *
 * Call sites that want to show a specific message can `instanceof`-check this;
 * those that already have a generic network-error handler can leave it falling
 * through to the same catch block.
 */
export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, url: string) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchJsonOptions extends Omit<RequestInit, 'body'> {
  /** Request body. Serialised to JSON automatically; do not pre-stringify. */
  body?: unknown;
  /**
   * Request timeout in milliseconds. Defaults to 10 000ms (10s).
   * Pass `0` to disable the timeout entirely — for long-polling or when you
   * supply your own `signal` that already encodes a deadline.
   */
  timeoutMs?: number;
}

/**
 * Fetch a JSON endpoint and return the parsed response as `T`.
 *
 * @throws {FetchError}        when the server returns a non-2xx status.
 * @throws {FetchTimeoutError} when the request exceeds `timeoutMs`.
 * @throws {TypeError}         when a network-level failure occurs (no connection, CORS, etc.).
 */
export async function fetchJson<T = unknown>(
  url: string,
  { body, headers, timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest }: FetchJsonOptions = {}
): Promise<T> {
  // Build a timeout signal unless the caller disabled it or supplied their own.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutController: AbortController | undefined;
  let effectiveSignal: AbortSignal | undefined;

  if (timeoutMs > 0) {
    timeoutController = new AbortController();
    timer = setTimeout(() => timeoutController!.abort(), timeoutMs);

    if (callerSignal) {
      // Merge the two signals: whichever fires first wins.
      // AbortSignal.any is available in Node 20+; use a manual fallback for older runtimes.
      if (typeof AbortSignal.any === 'function') {
        effectiveSignal = AbortSignal.any([timeoutController.signal, callerSignal]);
      } else {
        const merged = new AbortController();
        const abort = () => merged.abort();
        timeoutController.signal.addEventListener('abort', abort, { once: true });
        callerSignal.addEventListener('abort', abort, { once: true });
        effectiveSignal = merged.signal;
      }
    } else {
      effectiveSignal = timeoutController.signal;
    }
  } else {
    // RequestInit.signal is AbortSignal | null | undefined; treat null as absent.
    effectiveSignal = callerSignal ?? undefined;
  }

  const isBodyRequest =
    rest.method != null &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(rest.method.toUpperCase());

  const init: RequestInit = {
    ...rest,
    signal: effectiveSignal,
    headers: {
      // Only set Content-Type automatically for body-carrying requests so that
      // GET/HEAD calls don't send a spurious header.
      ...(isBodyRequest && body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      // Caller-supplied headers take precedence.
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // Clear the timer regardless so we don't leak it.
    if (timer !== undefined) clearTimeout(timer);

    // AbortError from our own controller → timeout.
    if (
      timeoutController?.signal.aborted &&
      err instanceof Error &&
      err.name === 'AbortError'
    ) {
      throw new FetchTimeoutError(timeoutMs, url);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  // Try to parse the body even on error — many API routes return a JSON object
  // with a `message` field explaining what went wrong.
  let parsed: unknown = null;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      parsed = await res.json();
    } catch {
      // Ignore parse failures; `parsed` stays null.
    }
  }

  if (!res.ok) {
    const message =
      parsed != null &&
      typeof parsed === 'object' &&
      'message' in (parsed as object) &&
      typeof (parsed as Record<string, unknown>).message === 'string'
        ? (parsed as Record<string, unknown>).message as string
        : `HTTP ${res.status} ${res.statusText}`;
    throw new FetchError(res.status, parsed, message);
  }

  return parsed as T;
}
