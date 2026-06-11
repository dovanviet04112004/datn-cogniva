'use client';

import * as React from 'react';

import { DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale, translate, type Locale } from './dict';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
};

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale ?? DEFAULT_LOCALE);

  const setLocale = React.useCallback(
    (next: Locale) => {
      if (next === locale) return;
      setLocaleState(next);
      try {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
        document.documentElement.lang = next;
      } catch {}
    },
    [locale],
  );

  const t = React.useCallback((key: string) => translate(locale, key), [locale]);

  const value = React.useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = React.useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => undefined,
      t: (key) => translate(DEFAULT_LOCALE, key),
    };
  }
  return ctx;
}

export function useT(): (key: string) => string {
  return useLocale().t;
}

export function readLocaleFromCookie(cookieValue: string | null | undefined): Locale {
  return parseLocale(cookieValue);
}
