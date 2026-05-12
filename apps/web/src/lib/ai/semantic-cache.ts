/**
 * Semantic cache — Redis-backed response cache cho LLM call.
 *
 * Plan v2 §15.1 W6: 30% cache hit rate cho repeat queries → cost save lớn.
 *
 * Strategy v1 (exact hash):
 *   Cache key = hash(normalize(query) + hash(systemPrompt) + scope)
 *   Hit = identical question từ cùng user (vd reload page, hỏi lại)
 *   TTL = 5 phút mặc định
 *
 * Strategy v2 (semantic similarity, Stage 2):
 *   Embed query → ANN search trong Qdrant cached entries
 *   Hit threshold cosine > 0.92
 *   Tốt cho FAQ-like queries với phrasing khác nhau
 *
 * KHÔNG dùng cho:
 *   - Conversational follow-up (mỗi message depend trên prev)
 *   - Personalized output (user data trong prompt → user khác không reuse được)
 *   - Live data (giá, weather, stock)
 *
 * Tốt cho:
 *   - RAG static knowledge ("định lý Pythagoras là gì")
 *   - Quiz/flashcard gen (deterministic input)
 *   - Translation
 *   - Classification
 *
 * Scope key:
 *   - userId: cache riêng per user (mặc định) — tránh leak doc privacy
 *   - shared: cache global cho factual content (chỉ enable nếu query
 *     không user-specific)
 */
import { createHash } from 'node:crypto';

import { getRedis } from '../redis';
import { logger } from '../observability/logger';

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

/**
 * Generate cache key.
 *
 * Format: `aicache:v1:{scope}:{useCase}:{userOrShared}:{hash}`
 *
 * Version trong key giúp invalidate toàn bộ cache khi đổi prompt template
 * (bump v1 → v2 → mọi cũ key miss).
 */
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
 * Lookup cache. Trả null nếu miss (kể cả Redis error — fail-open).
 *
 * @returns CachedResponse nếu hit, null nếu miss.
 */
export async function getCachedResponse(
  args: CacheLookupArgs,
): Promise<CachedResponse | null> {
  const redis = getRedis();
  const key = buildKey(args);
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw as string) as CachedResponse;
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

/**
 * Save response vào cache. Best-effort — log lỗi nhưng không throw.
 *
 * @param ttlSec - Override TTL nếu cần (vd shorter cho time-sensitive).
 */
export async function setCachedResponse(
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

/**
 * Stream cached text từng chunk — caller dùng để mimic streamText behavior.
 *
 * Chunk size + delay tuỳ chỉnh:
 *   - chunkSize=8 char + delay=10ms → tốc độ giống Sonnet real (~80 tok/s)
 *   - chunkSize=30 + delay=5 → fast UX nếu UI có streaming animation
 *
 * Trả AsyncIterable<string> compat với streamText().textStream.
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

/**
 * Invalidate cache cho 1 user (vd khi user upload doc mới — old answer stale).
 * Pattern: SCAN keys với prefix matching → DEL.
 *
 * KHÔNG dùng KEYS * (block Redis). SCAN không atomic nhưng OK cho cleanup.
 *
 * TODO Stage 2: implement scan-based invalidate khi cần. Hiện chỉ stub.
 */
export async function invalidateUserCache(userId: string, useCase?: string): Promise<void> {
  // Upstash REST không hỗ trợ SCAN cursor. Stage 2 chuyển DragonflyDB self-host
  // → SCAN sẵn. Hiện stub log để biết invalidation point.
  logger.info('ai-cache.invalidate_user_stub', { user_id: userId, use_case: useCase });
}

/**
 * Stats cache cho dashboard (Stage 2 metric).
 * Trả counter cho hit/miss per use case.
 */
export type CacheStats = {
  hitCount: number;
  missCount: number;
  hitRate: number;
};

export async function getCacheStats(useCase: string): Promise<CacheStats> {
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

/**
 * Increment counter — gọi từ router sau mỗi cache check.
 * Counter TTL 24h để dashboard show "last day" stats.
 */
export async function recordCacheStat(
  useCase: string,
  hit: boolean,
): Promise<void> {
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
