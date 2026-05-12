/**
 * AI cost guardrail — per-user daily quota + global circuit breaker.
 *
 * Plan v2 §0.3 risk A2 (Score 25, highest): AI cost runaway.
 * 1 prompt template lỗi + abuse = $5K/day. Guardrail BẮT BUỘC trước khi launch.
 *
 * 3 lớp bảo vệ:
 *
 *   Lớp 1 — Per-request hard cap:
 *     Mỗi LLM call max $1 (free) / $5 (pro) / $20 (team).
 *     Stop runaway loop / context bloat.
 *
 *   Lớp 2 — Per-user daily quota:
 *     - Free: $0.50/day
 *     - Pro:  $5.00/day
 *     - Team: $50.00/day
 *     - Enterprise: custom (set per-org)
 *     Cộng dồn mọi LLM call qua Redis daily counter. Vượt → block đến 00:00 UTC.
 *
 *   Lớp 3 — Global hourly circuit breaker:
 *     Tổng cost mọi user > $threshold/hour → alarm + disable AI features.
 *     Phòng case zero-day attack hoặc bug fanout.
 *
 * Pattern check trước call:
 *   const guard = await checkCostGuardrail({ userId, plan, estimatedCostUsd });
 *   if (!guard.allowed) return Response.json({ error: guard.reason }, { status: 429 });
 *   // ... call LLM
 *   await recordCost({ userId, plan, actualCostUsd, model });
 *
 * KHÔNG charge estimate (vì user chưa nhận response) — chỉ check ngưỡng.
 * Record actual sau khi LLM trả về với usage thật.
 */
import { getRedis } from '../redis';
import { logger } from './logger';
import { getUserConsentState } from '../coppa';

/** Plan tier — match với schema user.plan. */
export type Plan = 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';

/**
 * Daily quota theo plan (USD).
 * Override qua env `COST_QUOTA_<PLAN>_USD` cho A/B test pricing.
 */
const DAILY_QUOTA_USD: Record<Plan, number> = {
  FREE: parseFloat(process.env.COST_QUOTA_FREE_USD ?? '0.50'),
  PRO: parseFloat(process.env.COST_QUOTA_PRO_USD ?? '5.00'),
  TEAM: parseFloat(process.env.COST_QUOTA_TEAM_USD ?? '50.00'),
  ENTERPRISE: parseFloat(process.env.COST_QUOTA_ENTERPRISE_USD ?? '500.00'),
};

/** Per-request hard cap (USD) — chống runaway 1 request. */
const REQUEST_HARD_CAP_USD: Record<Plan, number> = {
  FREE: 0.20,
  PRO: 1.00,
  TEAM: 5.00,
  ENTERPRISE: 20.00,
};

/**
 * Global hourly threshold — alarm + disable nếu vượt.
 * Default $50/hour (~$1200/day worst case). Đủ cho 100 paying user ở Stage 1.
 * Override qua env `COST_GLOBAL_HOURLY_THRESHOLD_USD`.
 */
const GLOBAL_HOURLY_THRESHOLD_USD = parseFloat(
  process.env.COST_GLOBAL_HOURLY_THRESHOLD_USD ?? '50',
);

/** Key generators — namespace để debug dễ. */
function userDailyKey(userId: string, date = new Date()): string {
  // Format YYYY-MM-DD theo UTC để consistent giữa region
  const day = date.toISOString().slice(0, 10);
  return `cost:user:${userId}:${day}`;
}

function globalHourlyKey(date = new Date()): string {
  // Format YYYY-MM-DD-HH
  const iso = date.toISOString();
  return `cost:global:${iso.slice(0, 13)}`;
}

/**
 * Multiplier để convert USD → integer cents (Redis INCR atomic on int).
 * USD * 1_000_000 = micro-dollar precision (6 digit sau dấu phẩy).
 */
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
      reason: 'PER_REQUEST_CAP' | 'DAILY_QUOTA' | 'GLOBAL_CIRCUIT' | 'COPPA_PENDING';
      message: string;
      remaining: number;
      quota: number;
      resetAt?: string;
    };

/**
 * Check 3-layer guardrail. KHÔNG charge — chỉ verify ngưỡng.
 * Caller phải gọi recordCost() sau khi LLM call xong.
 */
export async function checkCostGuardrail(
  check: GuardrailCheck,
): Promise<GuardrailResult> {
  const { userId, plan, estimatedCostUsd } = check;
  const quota = DAILY_QUOTA_USD[plan];
  const cap = REQUEST_HARD_CAP_USD[plan];

  // ── Lớp 0: COPPA consent gate (Plan v2 §3.7.2) ──────
  // PENDING/REJECTED → block hết AI. KHÔNG depend trên DB nếu Redis-only setup.
  // Best-effort: nếu DB error → fail-open (allow) để avoid full outage.
  try {
    const consent = await getUserConsentState(userId);
    if (consent && consent.isLimited) {
      logger.warn('cost.guardrail.blocked', {
        reason: 'COPPA_PENDING',
        user_id: userId,
        consent_status: consent.status,
      });
      return {
        allowed: false,
        reason: 'COPPA_PENDING',
        message:
          consent.status === 'REJECTED'
            ? 'Account đã bị từ chối bởi cha mẹ. Liên hệ support@cogniva.app.'
            : 'Đang đợi cha mẹ xác nhận. Account sẽ unlock sau khi parent đồng ý.',
        remaining: 0,
        quota: 0,
      };
    }
  } catch (err) {
    logger.warn('cost.guardrail.coppa_check_fail', {
      user_id: userId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail-open: tiếp tục các lớp dưới
  }

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
    const globalRaw = await redis.get(globalHourlyKey());
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
        resetAt: nextHourIso(),
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
    const userRaw = await redis.get(userDailyKey(userId));
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
        resetAt: nextMidnightUtcIso(),
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
 * Record actual cost sau khi LLM call xong.
 * Atomic INCR cho cả user daily + global hourly counter.
 * Set TTL lần đầu (24h + 1h, tự xoá).
 *
 * @param costUsd - Cost USD thực tế từ token usage.
 */
export async function recordCost(args: {
  userId: string;
  plan: Plan;
  costUsd: number;
  model: string;
  /** Optional: tag use case cho cost breakdown analytics. */
  feature?: string;
}): Promise<void> {
  if (args.costUsd <= 0) return;

  const redis = getRedis();
  const userKey = userDailyKey(args.userId);
  const globalKey = globalHourlyKey();
  const amount = Math.round(args.costUsd * USD_TO_INT);

  try {
    const pipeline = redis.pipeline();
    pipeline.incrby(userKey, amount);
    pipeline.expire(userKey, 86_400 + 3600); // 25h — vượt biên ngày 1h cho timezone edge
    pipeline.incrby(globalKey, amount);
    pipeline.expire(globalKey, 3600 + 300); // 1h 5min
    await pipeline.exec();

    // Log cost (sẽ flow vào ClickHouse Stage 2 cho dashboard)
    logger.info('cost.recorded', {
      user_id: args.userId,
      plan: args.plan,
      cost_usd: args.costUsd,
      model: args.model,
      feature: args.feature,
    });
  } catch (err) {
    // Recording fail KHÔNG block user (chỉ mất tracking)
    logger.error('cost.record.failed', {
      user_id: args.userId,
      cost_usd: args.costUsd,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Get current usage cho 1 user (UI dashboard, account page).
 */
export async function getUserDailyUsage(
  userId: string,
  plan: Plan,
): Promise<{ spentUsd: number; quotaUsd: number; remainingUsd: number; resetAt: string }> {
  const redis = getRedis();
  const quota = DAILY_QUOTA_USD[plan];
  try {
    const raw = await redis.get(userDailyKey(userId));
    const spent = raw ? Number(raw) / USD_TO_INT : 0;
    return {
      spentUsd: spent,
      quotaUsd: quota,
      remainingUsd: Math.max(0, quota - spent),
      resetAt: nextMidnightUtcIso(),
    };
  } catch {
    return {
      spentUsd: 0,
      quotaUsd: quota,
      remainingUsd: quota,
      resetAt: nextMidnightUtcIso(),
    };
  }
}

/**
 * Admin tool — reset quota cho 1 user (vd customer support refund).
 * KHÔNG expose qua API public.
 */
export async function resetUserQuota(userId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(userDailyKey(userId));
  logger.info('cost.quota.reset', { user_id: userId });
}

/**
 * Get global hourly spend — admin dashboard.
 */
export async function getGlobalHourlySpend(): Promise<{
  spentUsd: number;
  thresholdUsd: number;
  circuitOpen: boolean;
}> {
  const redis = getRedis();
  try {
    const raw = await redis.get(globalHourlyKey());
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

/** Helper: ISO của midnight UTC kế tiếp. */
function nextMidnightUtcIso(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Helper: ISO của đầu giờ kế tiếp. */
function nextHourIso(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.toISOString();
}

/**
 * Estimate cost từ input tokens + max output tokens cap.
 * Conservative: dùng output cap thay vì expected output (chống underestimate).
 */
export function estimateCostUsd(args: {
  inputTokens: number;
  maxOutputTokens: number;
  inputPerMUsd: number;
  outputPerMUsd: number;
}): number {
  return (
    (args.inputTokens * args.inputPerMUsd +
      args.maxOutputTokens * args.outputPerMUsd) /
    1_000_000
  );
}
