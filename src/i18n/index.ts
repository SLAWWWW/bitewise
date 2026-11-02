/**
 * i18n core (pure, usable on server and client).
 *
 *   t('common', 'nav.flo')                       → 'FLO'
 *   t('common', 'masuk.choose', { name }, 'en')  → 'Sign in as …'
 *
 * Server components: `import { getLocale, getT } from '@/src/i18n/server'`.
 * Client components: `import { useT, useLocale } from '@/src/i18n/client'` (inside
 * <I18nProvider>, which app/layout.tsx mounts with the cookie locale).
 *
 * Lookup order: exact flat key → dotted path into nested objects → same in 'id' →
 * the key itself (so a missing translation is visible but never crashes).
 */
import { DICTIONARIES, type Namespace } from './registry';
import { DEFAULT_LOCALE, isLocale, type Dict, type Locale } from './types';

export { DICTIONARIES, NAMESPACES, type Namespace } from './registry';
export { DEFAULT_LOCALE, LOCALES, isLocale, type Dict, type Locale } from './types';

export type Vars = Record<string, string | number>;

function lookup(dict: Dict | undefined, key: string): string | undefined {
  if (!dict) return undefined;
  const flat = dict[key];
  if (typeof flat === 'string') return flat;
  let cur: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (cur === undefined || typeof cur === 'string') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

export function hasKey(ns: Namespace, key: string, locale: Locale = DEFAULT_LOCALE): boolean {
  return lookup(DICTIONARIES[locale]?.[ns], key) !== undefined;
}

export function t(ns: Namespace, key: string, vars?: Vars, locale: Locale = DEFAULT_LOCALE): string {
  const loc = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const s = lookup(DICTIONARIES[loc]?.[ns], key) ?? lookup(DICTIONARIES[DEFAULT_LOCALE]?.[ns], key) ?? key;
  return interpolate(s, vars);
}

export type TFn = (key: string, vars?: Vars) => string;

/** Bind namespace + locale. */
export function makeT(ns: Namespace, locale: Locale): TFn {
  return (key, vars) => t(ns, key, vars, locale);
}

/** Map BCP-47 for Intl APIs. */
export function intlLocale(locale: Locale): string {
  return locale === 'en' ? 'en-GB' : 'id-ID';
}

/** Translate a membership role label like 'ADMIN+COORDINATOR'; unknown labels pass through. */
export function roleLabel(label: string, locale: Locale = DEFAULT_LOCALE): string {
  const parts = label.split(/[+,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length && parts.every((p) => hasKey('common', `role.${p}`, locale))) {
    return parts.map((p) => t('common', `role.${p}`, undefined, locale)).join(' + ');
  }
  return label;
}
