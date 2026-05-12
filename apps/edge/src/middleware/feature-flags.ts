/**
 * Feature flag eval middleware — đọc flag config từ KV namespace FLAGS_KV.
 *
 * Schema KV (key → value JSON):
 *   "flag:{name}" → {
 *     enabled: boolean,
 *     rollout: number,        // 0..100 percentage
 *     allowList: string[],    // userIds always-on
 *     denyList: string[],     // userIds always-off
 *   }
 *
 * Edge eval logic:
 *   1. Read flag từ KV (cache hot key 60s tại edge — KV tự cache).
 *   2. Deny list hit → false
 *   3. Allow list hit → true
 *   4. Rollout: hash(userId + flagName) % 100 < rollout%
 *   5. Default disabled → false
 *
 * Expose qua header `x-cogniva-flags` (CSV) cho origin biết flag state:
 *   x-cogniva-flags: ai_v2,new_dashboard
 *
 * Origin Next.js đọc header thay vì re-eval → consistent giữa edge + origin
 * trong same request. Stage 2 W3 sẽ wire client SDK đọc cookie tương tự.
 */
import type { MiddlewareHandler } from 'hono';

import type { HonoEnv } from '../env';
import { logger } from '../lib/logger';

interface FlagConfig {
  enabled: boolean;
  rollout?: number;
  allowList?: string[];
  denyList?: string[];
}

/**
 * Danh sách flag cần eval mỗi request. Tránh eval toàn bộ flag (1000+) → chỉ
 * eval flag được dùng trong hot path origin. Mở rộng sau.
 */
const FLAGS_TO_EVAL = [
  'ai_v2',           // AI router v2 (Stage 2)
  'mobile_v1',       // Mobile app feature parity
  'edge_jwt',        // Edge JWT verify (kill switch)
  'cf_argo',         // Cloudflare Argo Smart Routing
];

/**
 * FNV-1a 32-bit hash — đủ cho rollout bucket (KHÔNG cần crypto, KHÔNG cần
 * đồng bộ với server JS Math.hash).
 */
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

    // Parallel KV reads — KV có cache nội bộ Workers, hot read ~5ms.
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
