import type { MiddlewareHandler } from 'hono';

import type { HonoEnv } from '../env';

const CONTINENT_TO_REGION: Record<string, string> = {
  AS: 'asia',
  EU: 'eu',
  NA: 'us',
  OC: 'asia',
  SA: 'us',
  AF: 'eu',
};

function inferContinent(country: string | null): string {
  if (!country) return 'NA';
  if (country === 'VN' || country === 'TH' || country === 'SG' || country === 'JP') return 'AS';
  if (['DE', 'FR', 'GB', 'IT', 'ES', 'NL', 'PL', 'SE'].includes(country)) return 'EU';
  if (['US', 'CA', 'MX'].includes(country)) return 'NA';
  if (['AU', 'NZ'].includes(country)) return 'OC';
  return 'NA';
}

export function geoMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const country = c.req.header('cf-ipcountry') ?? null;
    const cfObj = (c.req.raw as Request & { cf?: { continent?: string } }).cf;
    const cfContinent = cfObj?.continent;
    const continent = cfContinent ?? inferContinent(country);
    const region = CONTINENT_TO_REGION[continent] ?? 'us';

    c.set('country', country);
    c.set('region', region);

    c.header('x-cogniva-country', country ?? 'XX');
    c.header('x-cogniva-region', region);

    return next();
  };
}
