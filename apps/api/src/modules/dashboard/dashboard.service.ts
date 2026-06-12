import { Injectable } from '@nestjs/common';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';

import { PrismaService } from '../../infra/database/prisma.service';

export type DashboardRecentDoc = {
  id: string;
  filename: string;
  createdAt: string;
  status: string;
};

export type DashboardStats = {
  totalDocs: number;
  cardsDue: number;
  totalConv: number;
  xp: number;
  streak: number;
  recentDocs: DashboardRecentDoc[];
  firstWorkspaceId: string | null;
  hasFlashcards: boolean;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats(userId: string): Promise<DashboardStats> {
    return cached(ck.dashboard(userId), 60, () => this.fetchDashboardStats(userId));
  }

  private async fetchDashboardStats(userId: string): Promise<DashboardStats> {
    const [totalDocs, cardsDue, totalConv, stats, recentDocs, firstWs, fcCount] = await Promise.all(
      [
        this.prisma.document.count({ where: { user_id: userId } }),
        this.prisma.flashcard.count({
          where: { user_id: userId, due: { lte: new Date() } },
        }),
        this.prisma.conversation.count({ where: { user_id: userId } }),
        this.prisma.user_stats.findUnique({
          where: { user_id: userId },
          select: { xp: true, current_streak: true },
        }),
        this.prisma.document.findMany({
          where: { user_id: userId },
          orderBy: { created_at: 'desc' },
          take: 3,
          select: { id: true, filename: true, created_at: true, status: true },
        }),
        this.prisma.workspace.findFirst({
          where: { user_id: userId },
          orderBy: { created_at: 'desc' },
          select: { id: true },
        }),
        this.prisma.flashcard.count({ where: { user_id: userId } }),
      ],
    );

    return {
      totalDocs,
      cardsDue,
      totalConv,
      xp: stats?.xp ?? 0,
      streak: stats?.current_streak ?? 0,
      recentDocs: recentDocs.map((d) => ({
        id: d.id,
        filename: d.filename,
        createdAt: d.created_at.toISOString(),
        status: d.status,
      })),
      firstWorkspaceId: firstWs?.id ?? null,
      hasFlashcards: fcCount > 0,
    };
  }
}
