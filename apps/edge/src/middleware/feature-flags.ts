import type { MiddlewareHandler } from 'hono';

import type { HonoEnv } from '../env';
import { logger } from '../lib/logger';

interface FlagConfig {
  enabled: boolean;
  rollout?: number;
  allowList?: string[];
  denyList?: string[];
}

const FLAGS_TO_EVAL = ['ai_v2', 'mobile_v1', 'edge_jwt', 'cf_argo'];

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function evalFlag(cfg: FlagConfig | null, userId: string | null): boolean {
  if (!cfg) return false;
  if (!cfg.enabled) return false;
  if (userId) {
    if (cfg.denyList?.includes(userId)) return false;
    if (cfg.allowList?.includes(userId)) return true;
  }
  if (cfg.rollout === undefined || cfg.rollout >= 100) return true;
  if (cfg.rollout <= 0) return false;
  const key = `${userId ?? 'anon'}:${cfg.rollout}`;
  return fnv1a(key) % 100 < cfg.rollout;
}

export function featureFlags(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const userId = c.get('userId');
    const enabled: string[] = [];

    const results = await Promise.all(
      FLAGS_TO_EVAL.map(async (name) => {
        try {
          const raw = await c.env.FLAGS_KV.get<FlagConfig>(`flag:${name}`, 'json');
          return { name, on: evalFlag(raw, userId) };
        } catch (err) {
          logger.warn('feature_flag.read_error', {
            trace_id: c.get('traceId'),
            flag: name,
            error: err instanceof Error ? err.message : String(err),
          });
          return { name, on: false };
        }
      }),
    );

    for (const r of results) if (r.on) enabled.push(r.name);

    c.header('x-cogniva-flags', enabled.join(','));
    return next();
  };
}
