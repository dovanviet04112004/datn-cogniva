/**
 * LocaleProvider — Cogniva V8.27 i18n provider.
 *
 * Quản lý locale state (`vi` | `en`) + persist qua cookie `cogniva.locale`
 * (read SSR-side để tránh flash mismatch). Pattern giống next-themes:
 *   - Server: cookie → initial value pass vào provider
 *   - Client: thay đổi locale → setCookie + setState → re-render UI
 *
 * Hook `useT()` trả function `t(key)` translate string theo locale hiện tại.
 * Hook `useLocale()` trả `{ locale, setLocale }` cho UI toggle.
 */
'use client';

import * as React from 'react';

import { DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale, translate, type Locale } from './dict';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
};

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

/** 1 năm — locale stable lâu, không cần expire sớm. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(
    initialLocale ?? DEFAULT_LOCALE,
  );

  const setLocale = React.useCallback((next: Locale) => {
    if (next === locale) return;
    setLocaleState(next);
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
      // <html lang> update để screen reader + browser hint đúng.
      document.documentElement.lang = next;
    } catch {
      /* ignore — SSR hoặc cookie disabled */
    }
  }, [locale]);

  const t = React.useCallback((key: string) => translate(locale, key), [locale]);

  const value = React.useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/** Toàn bộ context — dùng khi cần cả locale + setLocale (vd settings toggle). */
export function useLocale(): LocaleContextValue {
  const ctx = React.useContext(LocaleContext);
  if (!ctx) {
    // Fallback no-op cho component render ngoài provider (vd test, storybook)
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => undefined,
      t: (key) => translate(DEFAULT_LOCALE, key),
    };
  }
  return ctx;
}

/** Shortcut chỉ cần `t()` (90% usecase). */
export function useT(): (key: string) => string {
  return useLocale().t;
}

/** Server helper — đọc cookie từ next/headers cookies(). Pass vào provider. */
export function readLocaleFromCookie(
  cookieValue: string | null | undefined,
): Locale {
  return parseLocale(cookieValue);
}
