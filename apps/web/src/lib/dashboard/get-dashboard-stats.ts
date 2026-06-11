import { and, count, desc, eq, lte } from 'drizzle-orm';

import { conversation, dbReplica, document, flashcard, userStats, workspace } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export type DashboardRecentDoc = {
  id: string;
  filename: string;
  createdAt: Date;
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

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const data = await cached(ck.dashboard(userId), 60, () => fetchDashboardStats(userId));
  return {
    ...data,
    recentDocs: data.recentDocs.map((d) => ({ ...d, createdAt: new Date(d.createdAt) })),
  };
}

async function fetchDashboardStats(userId: string): Promise<DashboardStats> {
  const [[docCountRow], [cardDueRow], [convCountRow], [stats], recentDocs, firstWs, [fcCountRow]] =
    await Promise.all([
      dbReplica
        .select({ n: count(document.id) })
        .from(document)
        .where(eq(document.userId, userId)),

      dbReplica
        .select({ n: count(flashcard.id) })
        .from(flashcard)
        .where(and(eq(flashcard.userId, userId), lte(flashcard.due, new Date()))),

      dbReplica
        .select({ n: count(conversation.id) })
        .from(conversation)
        .where(eq(conversation.userId, userId)),

      dbReplica
        .select({ xp: userStats.xp, currentStreak: userStats.currentStreak })
        .from(userStats)
        .where(eq(userStats.userId, userId))
        .limit(1),

      dbReplica
        .select({
          id: document.id,
          filename: document.filename,
          createdAt: document.createdAt,
          status: document.status,
        })
        .from(document)
        .where(eq(document.userId, userId))
        .orderBy(desc(document.createdAt))
        .limit(3),

      dbReplica
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.userId, userId))
        .orderBy(desc(workspace.createdAt))
        .limit(1),

      dbReplica
        .select({ n: count(flashcard.id) })
        .from(flashcard)
        .where(eq(flashcard.userId, userId)),
    ]);

  return {
    totalDocs: docCountRow?.n ?? 0,
    cardsDue: cardDueRow?.n ?? 0,
    totalConv: convCountRow?.n ?? 0,
    xp: stats?.xp ?? 0,
    streak: stats?.currentStreak ?? 0,
    recentDocs,
    firstWorkspaceId: firstWs[0]?.id ?? null,
    hasFlashcards: (fcCountRow?.n ?? 0) > 0,
  };
}
