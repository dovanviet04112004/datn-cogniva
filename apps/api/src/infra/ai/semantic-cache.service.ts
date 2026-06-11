import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { getRedis, logger } from '@cogniva/server-core';

const DEFAULT_TTL_SEC = 300;

export type CacheScope = 'user' | 'shared';

export type CachedResponse = {
  text: string;
  modelId: string;
  providerId: string;
  promptTokens: number;
  completionTokens: number;
  originalCostUsd: number;
  cachedAt: string;
};

export type CacheLookupArgs = {
  useCase: string;
  query: string;
  systemPrompt: string;
  scope: CacheScope;
  userId: string;
};

export type CacheStats = {
  hitCount: number;
  missCount: number;
  hitRate: number;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?!.,;:]+$/g, '')
    .trim();
}

function buildKey(args: CacheLookupArgs): string {
  const normalized = normalize(args.query);
  const sysHash = createHash('sha256').update(args.systemPrompt).digest('hex').slice(0, 16);
  const queryHash = createHash('sha256')
    .update(normalized + '|' + sysHash)
    .digest('hex')
    .slice(0, 24);
  const scopePart = args.scope === 'user' ? `u:${args.userId}` : 'shared';
  return `aicache:v1:${args.useCase}:${scopePart}:${queryHash}`;
}

export async function* streamCachedText(
  text: string,
  opts: { chunkSize?: number; delayMs?: number } = {},
): AsyncIterable<string> {
  const chunkSize = opts.chunkSize ?? 24;
  const delayMs = opts.delayMs ?? 10;
  for (let i = 0; i < text.length; i += chunkSize) {
    yield text.slice(i, i + chunkSize);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
}

@Injectable()
export class SemanticCacheService {
  async getCachedResponse(args: CacheLookupArgs): Promise<CachedResponse | null> {
    const redis = getRedis();
    const key = buildKey(args);
    try {
      const raw = await redis.get(key);
      if (!raw) return null;
      const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as CachedResponse;
      logger.info('ai-cache.hit', {
        use_case: args.useCase,
        scope: args.scope,
        user_id: args.userId,
        cached_at: parsed.cachedAt,
        original_cost_usd: parsed.originalCostUsd,
      });
      return parsed;
    } catch (err) {
      logger.warn('ai-cache.lookup_error', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async setCachedResponse(
    args: CacheLookupArgs & { response: CachedResponse; ttlSec?: number },
  ): Promise<void> {
    const redis = getRedis();
    const key = buildKey(args);
    const ttl = args.ttlSec ?? DEFAULT_TTL_SEC;
    try {
      await redis.set(key, JSON.stringify(args.response), { ex: ttl });
      logger.debug('ai-cache.set', {
        use_case: args.useCase,
        scope: args.scope,
        ttl_sec: ttl,
        text_len: args.response.text.length,
      });
    } catch (err) {
      logger.warn('ai-cache.set_error', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getCacheStats(useCase: string): Promise<CacheStats> {
    const redis = getRedis();
    try {
      const [hitRaw, missRaw] = await Promise.all([
        redis.get(`aicache:stats:hit:${useCase}`),
        redis.get(`aicache:stats:miss:${useCase}`),
      ]);
      const hit = hitRaw ? Number(hitRaw) : 0;
      const miss = missRaw ? Number(missRaw) : 0;
      const total = hit + miss;
      return {
        hitCount: hit,
        missCount: miss,
        hitRate: total === 0 ? 0 : hit / total,
      };
    } catch {
      return { hitCount: 0, missCount: 0, hitRate: 0 };
    }
  }

  async recordCacheStat(useCase: string, hit: boolean): Promise<void> {
    const redis = getRedis();
    const key = `aicache:stats:${hit ? 'hit' : 'miss'}:${useCase}`;
    try {
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, 86_400);
      await pipeline.exec();
    } catch {}
  }
}
