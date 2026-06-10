/**
 * GET /api/admin/ai/cost — aggregate cost stats cho dashboard.
 *
 * Query params:
 *   days (default 30, max 90) — window thời gian
 *
 * Response:
 *   summary:    { totalUsd, callCount, cacheHitCount, cacheHitRatio, uniqueUsers }
 *   byDay:      [{ day: 'YYYY-MM-DD', provider, costUsd, callCount }]  ← cho line chart
 *   byProvider: [{ provider, costUsd, callCount, share }]  ← cho pie chart (window này)
 *   byFeature:  [{ feature, costUsd, callCount }]  ← top use-case
 *   topUsers:   [{ userId, name, email, plan, costUsd, callCount }]  ← top 20 user
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { db } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DAYS = 90;

export async function GET(request: Request) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get('days') ?? 30);
  const days = Number.isFinite(daysRaw)
    ? Math.min(MAX_DAYS, Math.max(1, Math.floor(daysRaw)))
    : 30;

  const cutoff = sql.raw(`NOW() - INTERVAL '${days} days'`);

  // Chạy 4 query song song
  const [summary, byDay, byProvider, byFeature, topUsers] = await Promise.all([
    db.execute<{
      total_usd: number;
      call_count: number;
      cache_hit_count: number;
      unique_users: number;
    }>(sql`
      SELECT
        COALESCE(SUM(cost_usd), 0)::float AS total_usd,
        COUNT(*)::int AS call_count,
        COUNT(*) FILTER (WHERE cached = true)::int AS cache_hit_count,
        COUNT(DISTINCT user_id)::int AS unique_users
      FROM "ai_usage_log"
      WHERE created_at >= ${cutoff}
    `),
    db.execute<{
      day: string;
      provider: string;
      cost_usd: number;
      call_count: number;
    }>(sql`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
        provider,
        COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
        COUNT(*)::int AS call_count
      FROM "ai_usage_log"
      WHERE created_at >= ${cutoff}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `),
    db.execute<{ provider: string; cost_usd: number; call_count: number }>(sql`
      SELECT
        provider,
        COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
        COUNT(*)::int AS call_count
      FROM "ai_usage_log"
      WHERE created_at >= ${cutoff}
      GROUP BY 1
      ORDER BY cost_usd DESC
    `),
    db.execute<{ feature: string | null; cost_usd: number; call_count: number }>(sql`
      SELECT
        feature,
        COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
        COUNT(*)::int AS call_count
      FROM "ai_usage_log"
      WHERE created_at >= ${cutoff} AND feature IS NOT NULL
      GROUP BY 1
      ORDER BY cost_usd DESC
      LIMIT 20
    `),
    db.execute<{
      user_id: string;
      name: string | null;
      email: string;
      plan: string;
      cost_usd: number;
      call_count: number;
    }>(sql`
      SELECT
        l.user_id,
        u.name,
        u.email,
        u.plan,
        COALESCE(SUM(l.cost_usd), 0)::float AS cost_usd,
        COUNT(*)::int AS call_count
      FROM "ai_usage_log" l
      JOIN "user" u ON u.id = l.user_id
      WHERE l.created_at >= ${cutoff}
      GROUP BY l.user_id, u.name, u.email, u.plan
      ORDER BY cost_usd DESC
      LIMIT 20
    `),
  ]);

  const s = summary[0] ?? {
    total_usd: 0,
    call_count: 0,
    cache_hit_count: 0,
    unique_users: 0,
  };
  const totalCost = Number(s.total_usd) || 0;

  return NextResponse.json({
    days,
    summary: {
      totalUsd: totalCost,
      callCount: Number(s.call_count) || 0,
      cacheHitCount: Number(s.cache_hit_count) || 0,
      cacheHitRatio:
        Number(s.call_count) > 0
          ? Number(s.cache_hit_count) / Number(s.call_count)
          : 0,
      uniqueUsers: Number(s.unique_users) || 0,
    },
    byDay: byDay.map((r) => ({
      day: r.day,
      provider: r.provider,
      costUsd: Number(r.cost_usd) || 0,
      callCount: Number(r.call_count) || 0,
    })),
    byProvider: byProvider.map((r) => ({
      provider: r.provider,
      costUsd: Number(r.cost_usd) || 0,
      callCount: Number(r.call_count) || 0,
      share: totalCost > 0 ? Number(r.cost_usd) / totalCost : 0,
    })),
    byFeature: byFeature.map((r) => ({
      feature: r.feature,
      costUsd: Number(r.cost_usd) || 0,
      callCount: Number(r.call_count) || 0,
    })),
    topUsers: topUsers.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      plan: r.plan,
      costUsd: Number(r.cost_usd) || 0,
      callCount: Number(r.call_count) || 0,
    })),
  });
}
