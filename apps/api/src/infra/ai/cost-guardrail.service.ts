/**
 * CostGuardrailService — port từ apps/web/src/lib/observability/cost-guardrail.ts
 * (giữ nguyên key Redis / ngưỡng / message để Next + Nest sống chung 1 counter).
 *
 * 3 lớp bảo vệ:
 *   Lớp 1 — per-request hard cap theo plan (chống runaway 1 request).
 *   Lớp 2 — per-user daily quota (Redis counter, reset 00:00 UTC).
 *   Lớp 3 — global hourly circuit breaker (tổng cost mọi user/giờ).
 *
 * Pattern: check() trước khi gọi LLM (KHÔNG charge — chỉ verify ngưỡng),
 * record() sau khi có usage thật. Redis lỗi → fail-open như bản cũ.
 *
 * Khác bản web: BỎ lớp 0 COPPA consent gate (COPPA đã cắt khỏi scope).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { getRedis, logger } from '@cogniva/server-core';

import { PrismaService } from '../database/prisma.service';

/**
 * Plan tier — match schema user.plan. NGUỒN CHUẨN ở
 * apps/web/src/lib/observability/cost-guardrail.ts — đổi thì sửa cả 2
 * (@cogniva/shared là ESM-source, api CJS không import được).
 */
export type Plan = 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';

/** Daily quota theo plan (USD) — override qua env COST_QUOTA_<PLAN>_USD. */
const DAILY_QUOTA_USD: Record<Plan, number> = {
  FREE: parseFloat(process.env.COST_QUOTA_FREE_USD ?? '0.50'),
  PRO: parseFloat(process.env.COST_QUOTA_PRO_USD ?? '5.00'),
  TEAM: parseFloat(process.env.COST_QUOTA_TEAM_USD ?? '50.00'),
  ENTERPRISE: parseFloat(process.env.COST_QUOTA_ENTERPRISE_USD ?? '500.00'),
};

/** Per-request hard cap (USD). */
const REQUEST_HARD_CAP_USD: Record<Plan, number> = {
  FREE: 0.20,
  PRO: 1.00,
  TEAM: 5.00,
  ENTERPRISE: 20.00,
};

const GLOBAL_HOURLY_THRESHOLD_USD = parseFloat(
  process.env.COST_GLOBAL_HOURLY_THRESHOLD_USD ?? '50',
);

/** USD → micro-dollar int để Redis INCR atomic (6 digit precision). */
const USD_TO_INT = 1_000_000;

export type GuardrailCheck = {
  userId: string;
  plan: Plan;
  /** Estimate cost dựa trên input tokens + max_tokens cap. */
  estimatedCostUsd: number;
};

export type GuardrailResult =
  | { allowed: true; remaining: number; quota: number }
  | {
      allowed: false;
      reason: 'PER_REQUEST_CAP' | 'DAILY_QUOTA' | 'GLOBAL_CIRCUIT';
      message: string;
      remaining: number;
      quota: number;
      resetAt?: string;
    };

export type RecordCostParams = {
  userId: string;
  plan: Plan;
  /** Cost USD thực tế từ token usage (bản web đặt tên costUsd). */
  actualCostUsd: number;
  model: string;
  /** Optional: tag use case cho cost breakdown analytics. */
  feature?: string;
  /** Optional metrics — chỉ insert ai_usage_log, không ảnh hưởng counter Redis. */
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  cached?: boolean;
};

@Injectable()
export class CostGuardrailService {
  constructor(private readonly prisma: PrismaService) {}

  /** Check 3-layer guardrail. KHÔNG charge — caller phải gọi record() sau khi LLM xong. */
  async check(params: GuardrailCheck): Promise<GuardrailResult> {
    const { userId, plan, estimatedCostUsd } = params;
    const quota = DAILY_QUOTA_USD[plan];
    const cap = REQUEST_HARD_CAP_USD[plan];

    // ── Lớp 1: per-request hard cap ─────────────────────
    if (estimatedCostUsd > cap) {
      logger.warn('cost.guardrail.blocked', {
        reason: 'PER_REQUEST_CAP',
        user_id: userId,
        plan,
        estimated_usd: estimatedCostUsd,
        cap_usd: cap,
      });
      return {
        allowed: false,
        reason: 'PER_REQUEST_CAP',
        message: `Request estimate $${estimatedCostUsd.toFixed(4)} vượt cap $${cap}. Giảm độ dài context hoặc upgrade plan.`,
        remaining: 0,
        quota: cap,
      };
    }

    // ── Lớp 3: global circuit breaker (check trước daily — fail fast) ─
    const redis = getRedis();
    try {
      const globalRaw = await redis.get(this.globalHourlyKey());
      const globalUsd = globalRaw ? Number(globalRaw) / USD_TO_INT : 0;
      if (globalUsd > GLOBAL_HOURLY_THRESHOLD_USD) {
        logger.error('cost.guardrail.global_circuit_open', {
          global_hourly_usd: globalUsd,
          threshold_usd: GLOBAL_HOURLY_THRESHOLD_USD,
          user_id: userId,
        });
        return {
          allowed: false,
          reason: 'GLOBAL_CIRCUIT',
          message: 'AI tạm thời ngừng do tổng chi phí vượt ngưỡng. Vui lòng thử lại sau 1 giờ.',
          remaining: 0,
          quota: GLOBAL_HOURLY_THRESHOLD_USD,
          resetAt: this.nextHourIso(),
        };
      }
    } catch (err) {
      // Redis fail → log nhưng cho qua (fail-open như rate-limit)
      logger.warn('cost.guardrail.redis_error', {
        stage: 'global_check',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Lớp 2: per-user daily quota ─────────────────────
    try {
      const userRaw = await redis.get(this.userDailyKey(userId));
      const userUsd = userRaw ? Number(userRaw) / USD_TO_INT : 0;
      const remaining = quota - userUsd;

      if (userUsd + estimatedCostUsd > quota) {
        logger.warn('cost.guardrail.blocked', {
          reason: 'DAILY_QUOTA',
          user_id: userId,
          plan,
          spent_usd: userUsd,
          estimate_usd: estimatedCostUsd,
          quota_usd: quota,
        });
        return {
          allowed: false,
          reason: 'DAILY_QUOTA',
          message:
            plan === 'FREE'
              ? `Hết quota AI hôm nay ($${quota}). Upgrade Pro để có $${DAILY_QUOTA_USD.PRO}/ngày.`
              : `Hết quota AI hôm nay ($${quota}). Reset lúc 00:00 UTC.`,
          remaining: Math.max(0, remaining),
          quota,
          resetAt: this.nextMidnightUtcIso(),
        };
      }

      return { allowed: true, remaining, quota };
    } catch (err) {
      logger.warn('cost.guardrail.redis_error', {
        stage: 'user_check',
        error: err instanceof Error ? err.message : String(err),
      });
      // Fail-open: cho qua nếu Redis lỗi. Risk acceptable vs full outage.
      return { allowed: true, remaining: quota, quota };
    }
  }

  /**
   * Record actual cost sau LLM call: atomic INCR user daily + global hourly
   * (TTL tự xoá), rồi insert ai_usage_log fire-and-forget cho dashboard.
   */
  async record(params: RecordCostParams): Promise<void> {
    // Cached call (semantic-cache hit) cost=0 nhưng vẫn ghi DB để analytics
    // cache hit ratio. Chỉ skip nếu KHÔNG cached + cost <= 0.
    if (params.actualCostUsd <= 0 && !params.cached) return;

    const redis = getRedis();
    const userKey = this.userDailyKey(params.userId);
    const globalKey = this.globalHourlyKey();
    const amount = Math.round(params.actualCostUsd * USD_TO_INT);

    try {
      if (amount > 0) {
        const pipeline = redis.pipeline();
        pipeline.incrby(userKey, amount);
        pipeline.expire(userKey, 86_400 + 3600); // 25h — vượt biên ngày 1h cho timezone edge
        pipeline.incrby(globalKey, amount);
        pipeline.expire(globalKey, 3600 + 300); // 1h 5min
        await pipeline.exec();
      }

      // KHÔNG await vào response path — fire-and-forget, fail không break user flow.
      void this.prisma.ai_usage_log
        .create({
          data: {
            // Drizzle cũ $defaultFn cuid2; api dùng randomUUID (convention sẵn) — id opaque.
            id: randomUUID(),
            user_id: params.userId,
            plan: params.plan,
            provider: params.provider ?? this.inferProvider(params.model),
            model: params.model,
            feature: params.feature ?? null,
            tokens_in: params.tokensIn ?? 0,
            tokens_out: params.tokensOut ?? 0,
            cost_usd: params.actualCostUsd,
            latency_ms: params.latencyMs ?? null,
            cached: params.cached ?? false,
          },
        })
        .catch((err: unknown) => {
          logger.error('ai_usage_log.insert.failed', {
            user_id: params.userId,
            model: params.model,
            error: err instanceof Error ? err.message : String(err),
          });
        });

      logger.info('cost.recorded', {
        user_id: params.userId,
        plan: params.plan,
        cost_usd: params.actualCostUsd,
        model: params.model,
        feature: params.feature,
      });
    } catch (err) {
      // Recording fail KHÔNG block user (chỉ mất tracking)
      logger.error('cost.record.failed', {
        user_id: params.userId,
        cost_usd: params.actualCostUsd,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Usage daily của 1 user (đọc counter Redis) — port getUserDailyUsage web,
   * dùng cho GET /api/account/usage. Redis lỗi → trả 0 (fail-open y cũ).
   */
  async getUserDailyUsage(
    userId: string,
    plan: Plan,
  ): Promise<{ spentUsd: number; quotaUsd: number; remainingUsd: number; resetAt: string }> {
    const redis = getRedis();
    const quota = DAILY_QUOTA_USD[plan];
    try {
      const raw = await redis.get(this.userDailyKey(userId));
      const spent = raw ? Number(raw) / USD_TO_INT : 0;
      return {
        spentUsd: spent,
        quotaUsd: quota,
        remainingUsd: Math.max(0, quota - spent),
        resetAt: this.nextMidnightUtcIso(),
      };
    } catch {
      return {
        spentUsd: 0,
        quotaUsd: quota,
        remainingUsd: quota,
        resetAt: this.nextMidnightUtcIso(),
      };
    }
  }

  /**
   * Global hourly spend — port getGlobalHourlySpend web, dùng cho health check
   * + admin dashboard. Redis lỗi → circuit coi như đóng (fail-open).
   */
  async getGlobalHourlySpend(): Promise<{
    spentUsd: number;
    thresholdUsd: number;
    circuitOpen: boolean;
  }> {
    const redis = getRedis();
    try {
      const raw = await redis.get(this.globalHourlyKey());
      const spent = raw ? Number(raw) / USD_TO_INT : 0;
      return {
        spentUsd: spent,
        thresholdUsd: GLOBAL_HOURLY_THRESHOLD_USD,
        circuitOpen: spent > GLOBAL_HOURLY_THRESHOLD_USD,
      };
    } catch {
      return {
        spentUsd: 0,
        thresholdUsd: GLOBAL_HOURLY_THRESHOLD_USD,
        circuitOpen: false,
      };
    }
  }

  /** Key counter daily 1 user — format YYYY-MM-DD UTC, KHỚP bản web để share counter. */
  private userDailyKey(userId: string, date = new Date()): string {
    const day = date.toISOString().slice(0, 10);
    return `cost:user:${userId}:${day}`;
  }

  /** Key counter global theo giờ — format YYYY-MM-DDTHH. */
  private globalHourlyKey(date = new Date()): string {
    const iso = date.toISOString();
    return `cost:global:${iso.slice(0, 13)}`;
  }

  /** Infer provider từ model name nếu caller không truyền — heuristic như bản web. */
  private inferProvider(model: string): string {
    if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3'))
      return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('gemini-')) return 'google';
    if (model.startsWith('voyage-')) return 'voyage';
    if (model.includes('cohere') || model.startsWith('rerank-')) return 'cohere';
    if (model.includes('groq') || model.includes('llama')) return 'groq';
    return 'unknown';
  }

  private nextMidnightUtcIso(): string {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.toISOString();
  }

  private nextHourIso(): string {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d.toISOString();
  }
}
