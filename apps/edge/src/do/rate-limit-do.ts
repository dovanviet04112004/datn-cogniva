interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  resetAt: number;
}

export class RateLimitDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

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

  private async consume(cfg: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const stored = await this.state.storage.get<BucketState>('bucket');
    const prev: BucketState = stored ?? { tokens: cfg.capacity, lastRefillMs: now };

    const elapsedMs = Math.max(0, now - prev.lastRefillMs);
    const refilled = Math.min(cfg.capacity, prev.tokens + (elapsedMs / 1000) * cfg.refillPerSec);

    if (refilled >= 1) {
      const next: BucketState = { tokens: refilled - 1, lastRefillMs: now };
      await this.state.storage.put('bucket', next);
      const tokensNeeded = cfg.capacity - next.tokens;
      const resetAt = now + (tokensNeeded / cfg.refillPerSec) * 1000;
      return {
        allowed: true,
        remaining: Math.floor(next.tokens),
        retryAfterMs: 0,
        resetAt,
      };
    }

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
