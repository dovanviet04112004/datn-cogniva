/**
 * Server-side i18n helper (2026-05-27).
 *
 * Client components dùng `useT()` / `useLocale()` (hook). Server components
 * (page.tsx, server section) không dùng hook được → đọc cookie locale qua
 * next/headers + trả `t()` đã bind locale.
 *
 * Usage trong server component:
 *   const t = await getServerT();
 *   <h1>{t('library.hub.title')}</h1>
 */
import { cookies } from 'next/headers';

import { LOCALE_COOKIE, parseLocale, translate, type Locale } from './dict';

export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function getServerT(): Promise<(key: string) => string> {
  const locale = await getServerLocale();
  return (key: string) => translate(locale, key);
}
