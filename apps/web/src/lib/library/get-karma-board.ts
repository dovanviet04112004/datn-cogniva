import { desc, eq, sql } from 'drizzle-orm';

import {
  dbReplica,
  libraryDoc,
  libraryCreatorKarma,
  libraryKarmaEvent,
  user as userTable,
} from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export async function getKarmaBoard() {
  return cached(ck.karmaBoard(), 300, async () => {
    const leaderboard = await dbReplica
      .select({
        userId: libraryCreatorKarma.userId,
        points: libraryCreatorKarma.points,
        lastEventAt: libraryCreatorKarma.lastEventAt,
        name: userTable.name,
        image: userTable.image,
      })
      .from(libraryCreatorKarma)
      .leftJoin(userTable, eq(userTable.id, libraryCreatorKarma.userId))
      .orderBy(desc(libraryCreatorKarma.points))
      .limit(20);

    const recentEvents = await dbReplica
      .select({
        id: libraryKarmaEvent.id,
        userId: libraryKarmaEvent.userId,
        eventType: libraryKarmaEvent.eventType,
        points: libraryKarmaEvent.points,
        docId: libraryKarmaEvent.docId,
        createdAt: libraryKarmaEvent.createdAt,
        userName: userTable.name,
        userImage: userTable.image,
        docTitle: libraryDoc.title,
      })
      .from(libraryKarmaEvent)
      .leftJoin(userTable, eq(userTable.id, libraryKarmaEvent.userId))
      .leftJoin(libraryDoc, eq(libraryDoc.id, libraryKarmaEvent.docId))
      .orderBy(desc(libraryKarmaEvent.createdAt))
      .limit(15);

    const totalsByType = await dbReplica
      .select({
        eventType: libraryKarmaEvent.eventType,
        total: sql<number>`COUNT(*)::int`,
        totalPoints: sql<number>`SUM(${libraryKarmaEvent.points})::int`,
      })
      .from(libraryKarmaEvent)
      .groupBy(libraryKarmaEvent.eventType);

    return { leaderboard, recentEvents, totalsByType };
  });
}
