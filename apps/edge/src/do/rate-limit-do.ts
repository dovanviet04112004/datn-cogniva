/**
 * RateLimitDO — Durable Object cho rate limit per (userId or IP).
 *
 * Mỗi user (hoặc IP) có 1 DO instance riêng (globally unique by name).
 * Workers route request về cùng instance bất kể PoP nào hit edge.
 * → Token bucket consistent toàn cầu, KHÔNG cần Redis/db.
 *
 * Lưu trữ:
 *   - state.storage = transactional KV nhỏ (1MB) gắn liền với instance
 *   - tự động evict khi inactive lâu → cold start ~50ms nhưng state persist
 *
 * Algorithm: token bucket
 *   - capacity tokens (= max burst)
 *   - refill rate = tokens/sec
 *   - mỗi request consume 1 token; thiếu token → 429
 *
 * Why DO over Redis ZADD sliding window:
 *   - Workers KHÔNG có persistent TCP → Redis cần Upstash REST (overhead ~50ms)
 *   - DO co-located với edge logic, single round-trip, < 5ms p99
 *   - Strong consistency tự nhiên (DO chạy single-threaded)
 */

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitConfig {
  capacity: number;       // max tokens (= max burst)
  refillPerSec: number;   // tokens added per second
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;   // 0 nếu allowed
  resetAt: number;        // unix ms khi bucket full lại
}

export class RateLimitDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  /**
   * Workers route mọi request về cùng DO instance đều gọi fetch().
   * Body JSON = config (capacity, refillPerSec).
   */
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }
    let cfg: RateLimitConfig;
    try {
      cfg = (await request.json()) as RateLimitConfig;
    } catch {
      return new Response('bad json', { status: 400 });
    }

    const result = await this.consume(cfg);
    return Response.json(result);
  }

  /**
   * Consume 1 token từ bucket. Trả về kết quả + state mới persist xuống storage.
   *
   * Race safety: DO chạy single-threaded → KHÔNG cần lock. 2 request đồng thời
   * tới cùng DO sẽ serialize qua event loop. Cloudflare guarantee.
   */
  private async consume(cfg: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const stored = await this.state.storage.get<BucketState>('bucket');
    const prev: BucketState = stored ?? { tokens: cfg.capacity, lastRefillMs: now };

    // Refill: tokens += elapsed_sec * refillPerSec, cap = capacity
    const elapsedMs = Math.max(0, now - prev.lastRefillMs);
    const refilled = Math.min(cfg.capacity, prev.tokens + (elapsedMs / 1000) * cfg.refillPerSec);

    if (refilled >= 1) {
      const next: BucketState = { tokens: refilled - 1, lastRefillMs: now };
      await this.state.storage.put('bucket', next);
      // resetAt = khi bucket sẽ full lại (cho client biết)
      const tokensNeeded = cfg.capacity - next.tokens;
      const resetAt = now + (tokensNeeded / cfg.refillPerSec) * 1000;
      return {
        allowed: true,
        remaining: Math.floor(next.tokens),
        retryAfterMs: 0,
        resetAt,
      };
    }

    // Empty bucket — calculate retry after
    const tokensShort = 1 - refilled;
    const retryAfterMs = Math.ceil((tokensShort / cfg.refillPerSec) * 1000);
    const next: BucketState = { tokens: refilled, lastRefillMs: now };
    await this.state.storage.put('bucket', next);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
      resetAt: now + retryAfterMs,
    };
  }
}
