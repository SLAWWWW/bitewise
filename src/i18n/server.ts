/** Server-side locale helpers (reads the lb_locale cookie). */
import 'server-only';
import { cookies } from 'next/headers';
import { makeT, type Namespace, type TFn } from './index';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from './types';

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** `const t = await getT('flo'); t('list.title')` */
export async function getT(ns: Namespace): Promise<TFn> {
  return makeT(ns, await getLocale());
}
