/**
 * Job `reconcile-leaderboard` (mỗi 30') — rebuild ZSET LB_XP từ user_stats
 * chống drift (lbIncr là best-effort fail-open). Idempotent: DEL + ZADD batch
 * atomic qua Lua, chạy lại cho cùng kết quả. Port từ apps/web jobs.
 */
import { Injectable } from '@nestjs/common';
import { lbBackfill } from '@cogniva/server-core/cache/leaderboard';

import { PrismaService } from '../../../infra/database/prisma.service';

@Injectable()
export class ReconcileLeaderboardJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{ rebuilt: number }> {
    const all = await this.prisma.user_stats.findMany({ select: { user_id: true, xp: true } });
    await lbBackfill(all.map((r) => ({ userId: r.user_id, xp: r.xp })));
    return { rebuilt: all.length };
  }
}
