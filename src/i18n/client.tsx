'use client';

/** Client-side i18n: <I18nProvider locale> + useT(ns) / useLocale(). */
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { t as translate, type Namespace, type Vars } from './index';
import { DEFAULT_LOCALE, type Locale } from './types';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(ns: Namespace = 'common') {
  const locale = useLocale();
  return useCallback((key: string, vars?: Vars) => translate(ns, key, vars, locale), [ns, locale]);
}
