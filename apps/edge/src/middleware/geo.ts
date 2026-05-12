/**
 * Geo-IP middleware — đọc CF auto-injected header (cf-ipcountry) + cf object,
 * set country + region vào context, forward header cho origin biết.
 *
 * Region mapping (continent → DB read replica gần nhất):
 *   AS → asia       (Singapore replica)
 *   EU → eu         (Frankfurt replica)
 *   NA → us         (US-East primary)
 *   OC → asia       (gần nhất)
 *   SA, AF → us     (fallback primary)
 *
 * Origin Vercel Next.js đọc `x-cogniva-region` header → chọn `dbReplica` đúng
 * (xem packages/db/src/index.ts).
 *
 * Local dev (wrangler dev): KHÔNG có cf-ipcountry → fallback "XX" + region "us".
 */
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

/**
 * Map country code → continent (subset phổ biến). Workers cf.continent có
 * sẵn nhưng KHÔNG có ở `wrangler dev local` → cần fallback theo country.
 */
function inferContinent(country: string | null): string {
  if (!country) return 'NA';
  // Hot path Vietnam users
  if (country === 'VN' || country === 'TH' || country === 'SG' || country === 'JP') return 'AS';
  if (['DE', 'FR', 'GB', 'IT', 'ES', 'NL', 'PL', 'SE'].includes(country)) return 'EU';
  if (['US', 'CA', 'MX'].includes(country)) return 'NA';
  if (['AU', 'NZ'].includes(country)) return 'OC';
  return 'NA';
}

export function geoMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    // CF inject vào header (mọi tier) + cf object (Workers, paid).
    const country = c.req.header('cf-ipcountry') ?? null;
    // `cf` property tồn tại trong CF runtime (đã có trong @cloudflare/workers-types
    // IncomingRequestCfProperties). KHÔNG có ở `wrangler dev local` → optional.
    const cfObj = (c.req.raw as Request & { cf?: { continent?: string } }).cf;
    const cfContinent = cfObj?.continent;
    const continent = cfContinent ?? inferContinent(country);
    const region = CONTINENT_TO_REGION[continent] ?? 'us';

    c.set('country', country);
    c.set('region', region);

    // Forward downstream — origin Next.js đọc header này
    c.header('x-cogniva-country', country ?? 'XX');
    c.header('x-cogniva-region', region);

    return next();
  };
}
