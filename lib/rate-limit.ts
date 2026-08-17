/**
 * Fixed-window per-IP rate limiter — in-memory, no Redis. Good enough for a
 * single-instance hackathon deployment; the goal is stopping a burst of
 * scripted requests from silently exhausting the shared Gemini free-tier
 * quota (15 req/min) for every AI-assisted feature at once, not defending
 * against a distributed attacker.
 *
 * Deliberately not shared across serverless instances/cold starts — a
 * false negative here just means an occasional burst gets through, which
 * is the acceptable failure mode; a false positive (blocking a real user)
 * would not be.
 */
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > maxPerMinute;
}

/** Best-effort client identifier — trusts the platform-set header on Vercel,
 *  falls back to a shared bucket locally where every request is trusted anyway. */
export function clientKey(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  );
}
