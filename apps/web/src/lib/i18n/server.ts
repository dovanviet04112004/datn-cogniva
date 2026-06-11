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
