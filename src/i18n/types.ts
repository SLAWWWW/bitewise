/** A namespace dictionary: flat dotted keys and/or nested objects of strings. */
export interface Dict {
  [key: string]: string | Dict;
}

export const LOCALES = ['id', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'id';

export function isLocale(v: unknown): v is Locale {
  return v === 'id' || v === 'en';
}

/** Locale cookie (architecture G.4). Kept here so client code needs no node:crypto. */
export const LOCALE_COOKIE = 'lb_locale';
