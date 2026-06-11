import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { lbBackfill, lbTop } from '@cogniva/server-core/cache/leaderboard';

import { PrismaService } from '../../infra/database/prisma.service';

export type LeaderboardRow = {
  rank: number;
  userId: string;
  name: string | null;
  image: string | null;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  achievementsCount: number;
};

export type AnalyticsData = {
  totalMessages: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  last7Days: Array<{ date: string; messages: number; costUsd: number }>;
  byModel: Array<{ model: string; messages: number; costUsd: number }>;
};

@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

  async getLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
    const capped = Math.min(limit, 100);

    const top = await lbTop(capped * 3);
    if (top && top.length > 0) {
      const ids = top.map((t) => t.userId);
      const xpMap = new Map(top.map((t) => [t.userId, t.xp]));
      const hydrated = await this.prisma.user_stats.findMany({
        where: { user_id: { in: ids }, user: { is_public: true } },
        select: {
          user_id: true,
          current_streak: true,
          longest_streak: true,
          achievements: true,
          user: { select: { name: true, image: true } },
        },
      });

      return hydrated
        .map((r) => ({ ...r, xp: xpMap.get(r.user_id) ?? 0 }))
        .sort((a, b) => b.xp - a.xp)
        .slice(0, capped)
        .map((r, idx) => ({
          rank: idx + 1,
          userId: r.user_id,
          name: r.user.name,
          image: r.user.image,
          xp: r.xp,
          currentStreak: r.current_streak,
          longestStreak: r.longest_streak,
          achievementsCount: r.achievements?.length ?? 0,
        }));
    }

    const rows = await this.prisma.user_stats.findMany({
      where: { user: { is_public: true } },
      orderBy: { xp: 'desc' },
      take: capped,
      select: {
        user_id: true,
        xp: true,
        current_streak: true,
        longest_streak: true,
        achievements: true,
        user: { select: { name: true, image: true } },
      },
    });
    void this.backfillZset();
    return rows.map((r, idx) => ({
      rank: idx + 1,
      userId: r.user_id,
      name: r.user.name,
      image: r.user.image,
      xp: r.xp,
      currentStreak: r.current_streak,
      longestStreak: r.longest_streak,
      achievementsCount: r.achievements?.length ?? 0,
    }));
  }

  private async backfillZset(): Promise<void> {
    const all = await this.prisma.user_stats.findMany({ select: { user_id: true, xp: true } });
    await lbBackfill(all.map((r) => ({ userId: r.user_id, xp: r.xp })));
  }

  async getUserAnalytics(userId: string): Promise<AnalyticsData> {
    return cached(ck.analytics(userId), 300, () => this.fetchUserAnalytics(userId));
  }

  private async fetchUserAnalytics(userId: string): Promise<AnalyticsData> {
    type AggRow = {
      total_messages: number;
      total_prompt: number;
      total_completion: number;
      total_cost: string;
    };
    type DayRow = { day: string; messages: number; cost: string };
    type ModelRow = { model: string; messages: number; cost: string };

    const [aggRows, days, byModel] = await Promise.all([
      this.prisma.$queryRaw<AggRow[]>(Prisma.sql`
        SELECT
          count(*)::int AS total_messages,
          coalesce(sum((metadata->>'promptTokens')::int), 0)::int AS total_prompt,
          coalesce(sum((metadata->>'completionTokens')::int), 0)::int AS total_completion,
          coalesce(sum((metadata->>'costUsd')::numeric), 0)::text AS total_cost
        FROM message m
        INNER JOIN conversation c ON c.id = m.conversation_id
        WHERE c.user_id = ${userId}
          AND m.role = 'ASSISTANT'
          AND m.created_at > now() - interval '30 days'`),
      this.prisma.$queryRaw<DayRow[]>(Prisma.sql`
        SELECT
          to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
          count(*)::int AS messages,
          coalesce(sum((metadata->>'costUsd')::numeric), 0)::text AS cost
        FROM message m
        INNER JOIN conversation c ON c.id = m.conversation_id
        WHERE c.user_id = ${userId}
          AND m.role = 'ASSISTANT'
          AND m.created_at > now() - interval '7 days'
        GROUP BY day
        ORDER BY day ASC`),
      this.prisma.$queryRaw<ModelRow[]>(Prisma.sql`
        SELECT
          coalesce(metadata->>'model', 'unknown') AS model,
          count(*)::int AS messages,
          coalesce(sum((metadata->>'costUsd')::numeric), 0)::text AS cost
        FROM message m
        INNER JOIN conversation c ON c.id = m.conversation_id
        WHERE c.user_id = ${userId}
          AND m.role = 'ASSISTANT'
          AND m.created_at > now() - interval '30 days'
        GROUP BY model
        ORDER BY cost DESC`),
    ]);

    const agg = aggRows[0] ?? {
      total_messages: 0,
      total_prompt: 0,
      total_completion: 0,
      total_cost: '0',
    };
    return {
      totalMessages: Number(agg.total_messages),
      totalPromptTokens: Number(agg.total_prompt),
      totalCompletionTokens: Number(agg.total_completion),
      totalCostUsd: Number(agg.total_cost),
      last7Days: days.map((d) => ({
        date: d.day,
        messages: Number(d.messages),
        costUsd: Number(d.cost),
      })),
      byModel: byModel.map((m) => ({
        model: m.model,
        messages: Number(m.messages),
        costUsd: Number(m.cost),
      })),
    };
  }
}
