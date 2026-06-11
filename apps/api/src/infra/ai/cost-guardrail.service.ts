import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { getRedis, logger } from '@cogniva/server-core';

import { PrismaService } from '../database/prisma.service';

export type Plan = 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';

const DAILY_QUOTA_USD: Record<Plan, number> = {
  FREE: parseFloat(process.env.COST_QUOTA_FREE_USD ?? '0.50'),
  PRO: parseFloat(process.env.COST_QUOTA_PRO_USD ?? '5.00'),
  TEAM: parseFloat(process.env.COST_QUOTA_TEAM_USD ?? '50.00'),
  ENTERPRISE: parseFloat(process.env.COST_QUOTA_ENTERPRISE_USD ?? '500.00'),
};

const REQUEST_HARD_CAP_USD: Record<Plan, number> = {
  FREE: 0.2,
  PRO: 1.0,
  TEAM: 5.0,
  ENTERPRISE: 20.0,
};

const GLOBAL_HOURLY_THRESHOLD_USD = parseFloat(
  process.env.COST_GLOBAL_HOURLY_THRESHOLD_USD ?? '50',
);

const USD_TO_INT = 1_000_000;

export type GuardrailCheck = {
  userId: string;
  plan: Plan;
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
  actualCostUsd: number;
  model: string;
  feature?: string;
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  cached?: boolean;
};

@Injectable()
export class CostGuardrailService {
  constructor(private readonly prisma: PrismaService) {}

  async check(params: GuardrailCheck): Promise<GuardrailResult> {
    const { userId, plan, estimatedCostUsd } = params;
    const quota = DAILY_QUOTA_USD[plan];
    const cap = REQUEST_HARD_CAP_USD[plan];

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
      logger.warn('cost.guardrail.redis_error', {
        stage: 'global_check',
        error: err instanceof Error ? err.message : String(err),
      });
    }

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
      return { allowed: true, remaining: quota, quota };
    }
  }

  async record(params: RecordCostParams): Promise<void> {
    if (params.actualCostUsd <= 0 && !params.cached) return;

    const redis = getRedis();
    const userKey = this.userDailyKey(params.userId);
    const globalKey = this.globalHourlyKey();
    const amount = Math.round(params.actualCostUsd * USD_TO_INT);

    try {
      if (amount > 0) {
        const pipeline = redis.pipeline();
        pipeline.incrby(userKey, amount);
        pipeline.expire(userKey, 86_400 + 3600);
        pipeline.incrby(globalKey, amount);
        pipeline.expire(globalKey, 3600 + 300);
        await pipeline.exec();
      }

      void this.prisma.ai_usage_log
        .create({
          data: {
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
      logger.error('cost.record.failed', {
        user_id: params.userId,
        cost_usd: params.actualCostUsd,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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

  private userDailyKey(userId: string, date = new Date()): string {
    const day = date.toISOString().slice(0, 10);
    return `cost:user:${userId}:${day}`;
  }

  private globalHourlyKey(date = new Date()): string {
    const iso = date.toISOString();
    return `cost:global:${iso.slice(0, 13)}`;
  }

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
