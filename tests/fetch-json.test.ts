import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJson, FetchError, FetchTimeoutError } from '@/lib/utils/fetch-json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

// ---------------------------------------------------------------------------
// Setup: replace the global `fetch` with a vi.fn() for each test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Successful responses
// ---------------------------------------------------------------------------

describe('fetchJson — successful responses', () => {
  it('returns the parsed JSON body on 200', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, count: 3 }));
    const result = await fetchJson<{ ok: boolean; count: number }>('/api/test');
    expect(result).toEqual({ ok: true, count: 3 });
  });

  it('returns null when the response has no content-type JSON header', async () => {
    vi.mocked(fetch).mockResolvedValue(emptyResponse(204));
    const result = await fetchJson('/api/test');
    expect(result).toBeNull();
  });

  it('passes the method and serialised body to fetch', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));
    await fetchJson('/api/listings', { method: 'POST', body: { item: 'bread', qty: 5 } });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ item: 'bread', qty: 5 }));
  });

  it('sets Content-Type: application/json automatically for POST', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));
    await fetchJson('/api/listings', { method: 'POST', body: { x: 1 } });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('does NOT set Content-Type for a GET request', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ items: [] }));
    await fetchJson('/api/inventory');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('lets caller-supplied headers override the auto Content-Type', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));
    await fetchJson('/api/listings', {
      method: 'POST',
      body: { x: 1 },
      headers: { 'Content-Type': 'text/plain' },
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('text/plain');
  });
});

// ---------------------------------------------------------------------------
// HTTP error responses
// ---------------------------------------------------------------------------

describe('fetchJson — HTTP error responses', () => {
  it('throws FetchError for a 404', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'Not found' }, 404));
    await expect(fetchJson('/api/missing')).rejects.toBeInstanceOf(FetchError);
  });

  it('exposes the HTTP status on FetchError', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'Conflict' }, 409));
    try {
      await fetchJson('/api/claims');
    } catch (err) {
      expect(err).toBeInstanceOf(FetchError);
      expect((err as FetchError).status).toBe(409);
    }
  });

  it('copies the parsed JSON body onto FetchError.body', async () => {
    const body = { message: 'Already claimed', code: 'CONFLICT' };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(body, 409));
    try {
      await fetchJson('/api/claims');
    } catch (err) {
      expect((err as FetchError).body).toEqual(body);
    }
  });

  it('uses the JSON message field as the Error.message when present', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'Quota exceeded' }, 429));
    try {
      await fetchJson('/api/listings');
    } catch (err) {
      expect((err as FetchError).message).toBe('Quota exceeded');
    }
  });

  it('falls back to "HTTP <status> <statusText>" when body has no message', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'oops' }), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    try {
      await fetchJson('/api/fairness');
    } catch (err) {
      expect((err as FetchError).message).toBe('HTTP 500 Internal Server Error');
    }
  });

  it('does not throw for a 201 Created response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'abc' }, 201));
    await expect(fetchJson('/api/listings', { method: 'POST', body: {} })).resolves.toEqual({ id: 'abc' });
  });
});

// ---------------------------------------------------------------------------
// Timeout behaviour
// ---------------------------------------------------------------------------

describe('fetchJson — timeout', () => {
  it('throws FetchTimeoutError when the request exceeds timeoutMs', async () => {
    vi.useFakeTimers();

    vi.mocked(fetch).mockImplementation((_url, init) => {
      // Return a promise that rejects with AbortError when the signal fires.
      const p = new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        }
      });
      p.catch(() => undefined);
      return p;
    });

    // Attach a suppressor BEFORE advancing timers so vitest never sees an
    // unhandled rejection in the gap between throw and await.
    const promise = fetchJson('/api/slow', { timeoutMs: 3_000 });
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(3_001);

    await expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
  }, 10_000);

  it('exposes the configured timeoutMs on FetchTimeoutError', async () => {
    vi.useFakeTimers();

    vi.mocked(fetch).mockImplementation((_url, init) => {
      const p = new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        }
      });
      p.catch(() => undefined);
      return p;
    });

    const promise = fetchJson('/api/slow', { timeoutMs: 5_000 });
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(5_001);

    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FetchTimeoutError);
    expect((caught as FetchTimeoutError).timeoutMs).toBe(5_000);
  }, 10_000);

  it('does NOT time out when the response arrives before the deadline', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));

    const promise = fetchJson('/api/fast', { timeoutMs: 3_000 });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual({ ok: true });
  }, 10_000);

  it('respects timeoutMs: 0 (disabled) — never aborts on its own', async () => {
    vi.useFakeTimers();
    let resolveResponse!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () => new Promise<Response>((res) => { resolveResponse = res; })
    );

    const promise = fetchJson('/api/streaming', { timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(60_000);

    resolveResponse(jsonResponse({ done: true }));
    await expect(promise).resolves.toEqual({ done: true });
  }, 10_000);
});

// ---------------------------------------------------------------------------
// AbortSignal forwarding
// ---------------------------------------------------------------------------

describe('fetchJson — caller AbortSignal', () => {
  it('forwards the caller signal to fetch', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));
    const controller = new AbortController();
    await fetchJson('/api/test', { signal: controller.signal, timeoutMs: 0 });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).signal).toBe(controller.signal);
  });

  it('propagates a caller abort as an AbortError (not FetchTimeoutError)', async () => {
    const controller = new AbortController();

    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    });

    const promise = fetchJson('/api/test', { signal: controller.signal, timeoutMs: 0 });
    controller.abort();

    await expect(promise).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        err.name === 'AbortError' &&
        !(err instanceof FetchTimeoutError)
    );
  });
});
