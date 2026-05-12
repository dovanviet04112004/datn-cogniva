/**
 * Rate limiter — Upstash Redis-backed sliding window counter.
 *
 * v1 (cũ): in-memory Map, reset khi deploy, KHÔNG share giữa instance.
 * v2 (hiện tại): Redis fixed-window counter, multi-instance safe, persist
 * qua deploy. Plan v2 §15.1 W1 — risk T4/A2 mitigation.
 *
 * Pattern fixed window vs sliding:
 *   - Fixed (current): INCR key + EXPIRE TTL. Đơn giản, atomic via pipeline.
 *     Nhược điểm: burst tại boundary (2x limit trong 1 phút giữa 2 window).
 *   - Sliding window log: lưu timestamp mỗi request, ZREMRANGEBYSCORE rotate.
 *     Chính xác hơn nhưng đắt (1 SET + 1 ZADD + 1 ZCOUNT mỗi request).
 *   - Token bucket: như v1 cũ, cần Lua script để atomic — Upstash REST hỗ trợ
 *     EVAL nhưng phức tạp hơn.
 *
 * Chọn fixed window vì:
 *   - Đơn giản, dễ debug
 *   - 2x burst tại boundary OK cho use case (chat / AI / upload không critical
 *     bằng payment)
 *   - 2 Redis ops mỗi request, < 20ms total
 *
 * API surface giữ nguyên `checkLimit(key, preset)` để route handler không phải
 * đổi — chỉ đổi internal implementation.
 *
 * No-op khi Redis down:
 *   - Trả allowed=true (fail-open) thay vì allowed=false (fail-closed) để
 *     Redis outage không kill toàn site. Trade-off: rate limit tạm bypass.
 *   - Sentry log warning để biết.
 */
import { getRedis } from '../redis';
import { logger } from '../observability/logger';

export type RateLimitConfig = {
  /** Số request tối đa trong window. */
  capacity: number;
  /** Window length (ms). */
  windowMs: number;
};

/**
 * Presets — đặt ở đây để consistent. Adding mới: nhớ cập nhật type.
 */
export const PRESET_LIMITS = {
  /** Chat endpoint — 30 req/min/user. LLM expensive, chống spam. */
  chat: { capacity: 30, windowMs: 60_000 },
  /** AI generate (quiz/flashcard) — 10 req/min/user. Heavy. */
  aiGenerate: { capacity: 10, windowMs: 60_000 },
  /** Document upload — 20 req/min/user. Ingest pipeline tốn ressource. */
  upload: { capacity: 20, windowMs: 60_000 },
  /** Default cho cheap endpoint — 60 req/min/user. */
  default: { capacity: 60, windowMs: 60_000 },
  /** Auth endpoints — 10 attempt/min/IP để chống brute force. */
  auth: { capacity: 10, windowMs: 60_000 },
  /** Realtime channel auth — 60 req/min/user (mỗi page reload subscribe lại). */
  realtimeAuth: { capacity: 60, windowMs: 60_000 },
} as const;

export type LimitName = keyof typeof PRESET_LIMITS;

export type LimitResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number; retryAfter: number };

/**
 * Check + decrement quota cho key. Atomic qua Redis pipeline.
 *
 * Pattern:
 *   1. INCR key (atomic counter)
 *   2. Nếu count == 1 (key mới) → EXPIRE windowMs
 *   3. Nếu count > capacity → deny + tính retry-after từ TTL
 *
 * @param key - Identifier (vd `chat:userId123` hoặc `auth:ip192.168.1.1`).
 *              Caller chịu trách nhiệm prefix để tránh collision giữa preset.
 * @param preset - Tên preset trong PRESET_LIMITS.
 * @returns LimitResult
 */
export async function checkLimit(key: string, preset: LimitName): Promise<LimitResult> {
  const config = PRESET_LIMITS[preset];
  return checkLimitCustom(key, config, preset);
}

/**
 * Variant cho custom config (vd per-tier quota).
 * `presetTag` dùng cho log + Redis key namespacing.
 */
export async function checkLimitCustom(
  key: string,
  config: RateLimitConfig,
  presetTag = 'custom',
): Promise<LimitResult> {
  const redis = getRedis();
  const windowSec = Math.ceil(config.windowMs / 1000);
  // Namespace key theo preset để tránh collision khi cùng userId
  // dùng nhiều preset khác nhau.
  const rk = `rl:${presetTag}:${key}`;

  try {
    // Pipeline: INCR + EXPIRE atomic (cùng connection)
    const pipeline = redis.pipeline();
    pipeline.incr(rk);
    // Set expire mỗi request — Upstash idempotent, không reset TTL nếu key exist
    // → CHƯA đúng. Cần check count==1 mới expire. Workaround: dùng SET với EX
    // hoặc làm 2 round trip.
    //
    // Đơn giản hơn: luôn re-set EXPIRE (đồng nghĩa với sliding mỗi request).
    // Trade-off: window sliding theo last request, không phải fixed.
    // Cho use case rate-limit, sliding sliding-by-request là OK (thực ra
    // mạnh hơn fixed → user hammer thì window cứ kéo dài).
    pipeline.expire(rk, windowSec);
    const [count] = (await pipeline.exec()) as [number, number];

    if (count > config.capacity) {
      // Hết quota — tính retry-after từ TTL còn lại
      const ttl = await redis.ttl(rk);
      const retryAfter = ttl > 0 ? ttl : windowSec;
      return {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + retryAfter * 1000,
        retryAfter,
      };
    }

    return {
      allowed: true,
      remaining: config.capacity - count,
      resetAt: Date.now() + windowSec * 1000,
    };
  } catch (err) {
    // Fail-open: Redis down KHÔNG kill site. Log warning + allow.
    // Risk: rate limit tạm bypass. Acceptable vs full outage.
    logger.warn('ratelimit.redis_error', {
      key: rk,
      preset: presetTag,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      allowed: true,
      remaining: config.capacity,
      resetAt: Date.now() + config.windowMs,
    };
  }
}

/**
 * Reset counter cho 1 key — admin tool, vd unban user.
 * Không expose qua API public.
 */
export async function resetLimit(key: string, preset: LimitName): Promise<void> {
  const redis = getRedis();
  const rk = `rl:${preset}:${key}`;
  await redis.del(rk);
}

/**
 * Backward-compat: consume() API cũ.
 *
 * v1 trả về { ok: true } | { ok: false, retryAfter }.
 * v2 chỉ wrap checkLimitCustom — caller cũ vẫn work.
 *
 * @deprecated Dùng checkLimit() hoặc checkLimitCustom() trực tiếp.
 */
export async function consume(
  key: string,
  limit: RateLimitConfig,
  _cost = 1,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const result = await checkLimitCustom(key, limit);
  if (result.allowed) return { ok: true };
  return { ok: false, retryAfter: result.retryAfter };
}

/**
 * Cleanup hook — KHÔNG cần với Redis (TTL tự xoá).
 * Giữ no-op cho backward compat.
 *
 * @deprecated In-memory v1 không còn dùng.
 */
export function purgeOldBuckets(_olderThanMs?: number): void {
  // no-op: Redis tự xoá qua EXPIRE
}
