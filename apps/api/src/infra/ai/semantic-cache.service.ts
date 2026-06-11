/**
 * SemanticCacheService — port nguyên văn apps/web/src/lib/ai/semantic-cache.ts.
 *
 * Redis-backed response cache cho LLM call, v1 là EXACT HASH (KHÔNG embedding
 * similarity — đó là plan v2 Qdrant). Key contract GIỮ NGUYÊN để Next + Nest
 * sống chung 1 cache:
 *   aicache:v1:{useCase}:{u:userId|shared}:{sha256(normalize(query)+'|'+sysHash16)[:24]}
 *   TTL default 300s. Stats counter aicache:stats:{hit|miss}:{useCase} TTL 24h.
 *
 * Opt-in only (caller bật enableSemanticCache) — KHÔNG dùng cho conversational
 * chat (mỗi message phụ thuộc prev). Redis lỗi → fail-open (miss).
 */
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { getRedis, logger } from '@cogniva/server-core';

/** TTL mặc định 5 phút — đủ cho session ngắn, không stale quá. */
const DEFAULT_TTL_SEC = 300;

export type CacheScope = 'user' | 'shared';

export type CachedResponse = {
  /** Text response đã lưu. */
  text: string;
  /** Model ID đã dùng khi tạo (audit). */
  modelId: string;
  /** Provider ID. */
  providerId: string;
  /** Original prompt tokens (cho cost report). */
  promptTokens: number;
  completionTokens: number;
  /** Cost USD khi sinh original (cache user tiết kiệm này). */
  originalCostUsd: number;
  /** Khi cache entry tạo. */
  cachedAt: string;
};

export type CacheLookupArgs = {
  useCase: string;
  query: string;
  /** System prompt — hash để tránh stale khi prompt template đổi. */
  systemPrompt: string;
  scope: CacheScope;
  userId: string;
};

export type CacheStats = {
  hitCount: number;
  missCount: number;
  hitRate: number;
};

/**
 * Normalize query: lowercase + collapse whitespace + strip punctuation cuối.
 * Giúp "Lim là gì?" và "lim là gì" hit cùng cache entry.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?!.,;:]+$/g, '')
    .trim();
}

/** Generate cache key — version trong key giúp invalidate hàng loạt khi đổi template. */
function buildKey(args: CacheLookupArgs): string {
  const normalized = normalize(args.query);
  // Hash system prompt riêng để giảm key length (system thường dài 2-5KB)
  const sysHash = createHash('sha256')
    .update(args.systemPrompt)
    .digest('hex')
    .slice(0, 16);
  const queryHash = createHash('sha256')
    .update(normalized + '|' + sysHash)
    .digest('hex')
    .slice(0, 24);
  const scopePart = args.scope === 'user' ? `u:${args.userId}` : 'shared';
  return `aicache:v1:${args.useCase}:${scopePart}:${queryHash}`;
}

/**
 * Stream cached text từng chunk — mimic streamText().textStream (chunk 24
 * char/10ms như bản web). Module-level vì pure, không cần DI.
 */
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
  /** Lookup cache. Trả null nếu miss (kể cả Redis error — fail-open). */
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

  /** Save response vào cache. Best-effort — log lỗi nhưng không throw. */
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

  /** Stats cache cho dashboard — counter hit/miss per use case (24h window). */
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

  /** Increment counter — gọi từ router sau mỗi cache check. TTL 24h. */
  async recordCacheStat(useCase: string, hit: boolean): Promise<void> {
    const redis = getRedis();
    const key = `aicache:stats:${hit ? 'hit' : 'miss'}:${useCase}`;
    try {
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, 86_400);
      await pipeline.exec();
    } catch {
      // silent — stats không critical
    }
  }
}
