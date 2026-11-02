import { describe, expect, it } from 'vitest';
import { DEFAULT_AFTER_LOGIN, safeNextPath } from '@/src/security/redirect';

/** What the Next app router would do with the href: resolve against the current page. */
function resolvesOffSite(href: string): boolean {
  return new URL(href, 'http://localhost:3000/masuk').origin !== 'http://localhost:3000';
}

describe('safeNextPath (open-redirect guard for /masuk?next=)', () => {
  it.each([
    '/flo',
    '/flo/FLO-0001?tab=perjanjian',
    '/audit?cursor=abc#top',
    '/ringkasan',
  ])('keeps same-origin path %s', (v) => {
    expect(safeNextPath(v)).toBe(v);
  });

  it.each([
    ['backslash host', '/\\evil.com'],
    ['decoded %5C', decodeURIComponent('/%5Cevil.com')],
    ['double backslash', '/\\\\evil.com'],
    ['TAB then slash', '/\t/evil.com'],
    ['LF then slash', '/\n/evil.com'],
    ['CR then slash', '/\r/evil.com'],
    ['protocol-relative', '//evil.com'],
    ['absolute URL', 'https://evil.com/'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative path', 'flo'],
    ['empty', ''],
    ['login loop', '/masuk'],
    ['login loop with query', '/masuk?next=/flo'],
    ['login sub path', '/masuk/x'],
  ])('rejects %s', (_label, v) => {
    expect(safeNextPath(v)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it('the attack inputs really do resolve off-site without the guard', () => {
    expect(resolvesOffSite('/\\evil.com')).toBe(true);
    expect(resolvesOffSite('/\t/evil.com')).toBe(true);
  });

  it('never returns an href that resolves to another origin', () => {
    const inputs = ['/\\evil.com', '/\t/evil.com', '/%5Cevil.com', '/%2F%2Fevil.com', '/./\\evil.com', '/..//evil.com', '/a/../\\evil.com'];
    for (const v of inputs) expect(resolvesOffSite(safeNextPath(v))).toBe(false);
  });

  it('takes the first value of an array and defaults on undefined/null', () => {
    expect(safeNextPath(['/flo', '//evil.com'])).toBe('/flo');
    expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_LOGIN);
  });
});
