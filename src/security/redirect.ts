/**
 * Post-login redirect target validation (open-redirect guard for /masuk?next=...).
 *
 * Only a strict same-origin path is accepted. The WHATWG URL parser (used by the Next
 * router to resolve hrefs) treats '\' as '/' for http(s) and strips TAB/LF/CR, so a naive
 * `startsWith('/') && !startsWith('//')` check lets '/\evil.com' or '/\t/evil.com' escape
 * to another origin. We therefore (1) reject backslashes and any control character
 * outright and (2) resolve against a sentinel origin and require the origin to survive.
 */
const SENTINEL = 'http://lumbung.invalid';
export const DEFAULT_AFTER_LOGIN = '/ringkasan';

const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/;

export function safeNextPath(next: string | string[] | undefined | null): string {
  const v = Array.isArray(next) ? next[0] : next;
  if (typeof v !== 'string' || v.length === 0 || v.length > 2048) return DEFAULT_AFTER_LOGIN;
  if (!v.startsWith('/') || v.startsWith('//')) return DEFAULT_AFTER_LOGIN;
  if (UNSAFE_CHARS.test(v)) return DEFAULT_AFTER_LOGIN;
  let u: URL;
  try {
    u = new URL(v, SENTINEL);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (u.origin !== SENTINEL) return DEFAULT_AFTER_LOGIN;
  if (u.pathname === '/masuk' || u.pathname.startsWith('/masuk/')) return DEFAULT_AFTER_LOGIN;
  const out = u.pathname + u.search + u.hash;
  // Re-check the normalised form (e.g. '/./\x2f' style tricks collapsing to '//').
  if (!out.startsWith('/') || out.startsWith('//')) return DEFAULT_AFTER_LOGIN;
  return out;
}
