/**
 * GET /api/library/karma/leaderboard — Phase 4 karma leaderboard.
 *
 * Top N creators theo karma points + recent events.
 *
 * Query:
 *   ?limit=20   — default 20
 *
 * Response:
 *   {
 *     leaderboard: [{ userId, name, image, points, rank }],
 *     recentEvents: [{ userId, eventType, points, docId, docTitle, createdAt }],
 *     totalEarners: number
 *   }
 */
import { NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';

import {
  db,
  libraryDoc,
  libraryCreatorKarma,
  libraryKarmaEvent,
  user as userTable,
} from '@cogniva/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20);

  // Top creators
  const leaderboard = await db
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
    .limit(limit);

  // Recent events (latest 15)
  const recentEvents = await db
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

  const [stats] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(libraryCreatorKarma);

  return NextResponse.json({
    leaderboard: leaderboard.map((l, idx) => ({
      ...l,
      rank: idx + 1,
    })),
    recentEvents,
    totalEarners: stats?.total ?? 0,
  });
}
