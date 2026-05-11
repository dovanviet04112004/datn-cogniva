/**
 * Rate limiter — token bucket in-memory cho dev / Vercel single-instance.
 *
 * Mỗi key (vd userId hoặc IP) có 1 bucket với:
 *   - capacity: số request tối đa được phép trong window
 *   - refillRate: tokens/sec đổ thêm vào (capacity / window)
 *
 * Khi consume(key, cost) → nếu đủ token thì trừ + trả ok=true, không thì
 * trả false + retryAfter (giây).
 *
 * Limitations:
 *   - In-memory → multi-instance Vercel deploy sẽ KHÔNG share counter.
 *     Production thay bằng Upstash Redis (cùng interface).
 *   - Reset khi server restart (chấp nhận trade-off cho dev).
 *
 * Preset limits:
 *   - chat: 30 req / phút / user (LLM expensive)
 *   - aiGenerate: 10 req / phút / user (flashcard/quiz gen)
 *   - upload: 20 req / phút / user (ingest pipeline)
 *   - default: 60 req / phút / user (cheap endpoints)
 */

type Bucket = {
  tokens: number;
  lastRefill: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitConfig = {
  capacity: number;
  windowMs: number;
};

export const PRESET_LIMITS = {
  chat: { capacity: 30, windowMs: 60_000 },
  aiGenerate: { capacity: 10, windowMs: 60_000 },
  upload: { capacity: 20, windowMs: 60_000 },
  default: { capacity: 60, windowMs: 60_000 },
} as const;

export type LimitName = keyof typeof PRESET_LIMITS;

/**
 * Tiêu thụ 1 token cho `key`. Tự refill theo `lastRefill`.
 * @returns ok=true nếu được, false + retryAfter (giây) nếu hết quota.
 */
export function consume(
  key: string,
  limit: RateLimitConfig,
  cost = 1,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const refillRate = limit.capacity / limit.windowMs; // tokens/ms
  let b = buckets.get(key);

  if (!b) {
    b = { tokens: limit.capacity, lastRefill: now };
    buckets.set(key, b);
  } else {
    // Refill theo thời gian trôi qua
    const elapsed = now - b.lastRefill;
    b.tokens = Math.min(limit.capacity, b.tokens + elapsed * refillRate);
    b.lastRefill = now;
  }

  if (b.tokens >= cost) {
    b.tokens -= cost;
    return { ok: true };
  }

  // Thời gian cần đợi để có đủ token (giây)
  const need = cost - b.tokens;
  const retryAfter = Math.ceil(need / refillRate / 1000);
  return { ok: false, retryAfter };
}

/**
 * Helper convenient: chấp nhận limit-name preset thay vì config thô.
 * Trả NextResponse 429 nếu hết quota, hoặc null để cho phép tiếp tục.
 */
export function checkLimit(
  key: string,
  preset: LimitName,
): { allowed: boolean; retryAfter?: number } {
  const limit = PRESET_LIMITS[preset];
  const result = consume(key, limit);
  if (result.ok) return { allowed: true };
  return { allowed: false, retryAfter: result.retryAfter };
}

/**
 * Cleanup bucket cũ định kỳ (memory leak prevention).
 * Gọi từ 1 background interval nếu cần — Phase 10 v1 chấp nhận leak nhỏ.
 */
export function purgeOldBuckets(olderThanMs = 10 * 60_000) {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.lastRefill > olderThanMs) buckets.delete(k);
  }
}
