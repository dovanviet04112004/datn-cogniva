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
