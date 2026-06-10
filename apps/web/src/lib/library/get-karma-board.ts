/**
 * getKarmaBoard — leaderboard karma + activity feed cho /library/karma.
 *
 * Cache DATA công khai (xem ghi chú ở get-universities-directory): route bị
 * layout ép dynamic nên `revalidate` page vô tác dụng, dùng lớp Redis `cached()`
 * cache kết quả query (TTL 5 phút, feed đổi nhanh hơn catalog). Không có userId
 * trong query → an toàn chia sẻ giữa mọi visitor. Web-only.
 *
 * Lưu ý: cache serialize kết quả → field Date trả về dạng string; các trang tiêu
 * thụ đều bọc `new Date(...)` trước khi format nên không vỡ.
 */
import { desc, eq, sql } from 'drizzle-orm';

// dbReplica: karma board + feed công khai, read thuần → route replica.
import {
  dbReplica,
  libraryDoc,
  libraryCreatorKarma,
  libraryKarmaEvent,
  user as userTable,
} from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

/**
 * Bản CACHE Redis (cache-aside, TTL 300s) — thay `unstable_cache` cũ.
 * Lợi ích so với unstable_cache: có INVALIDATION thật (`onKarmaChanged` xoá key
 * khi awardKarma) thay vì chỉ chờ TTL (revalidateTag chưa từng được wire). Date
 * field (lastEventAt/createdAt) serialize→string y hệt unstable_cache cũ →
 * consumer đã bọc `new Date(...)`, không vỡ.
 */
export async function getKarmaBoard() {
  return cached(ck.karmaBoard(), 300, async () => {
    // Leaderboard top 20
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

    // Recent events
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

    // Total events by type
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
