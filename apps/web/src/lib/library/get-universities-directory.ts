/**
 * getUniversitiesDirectory — catalog trường + môn cho /library/universities.
 *
 * Vì sao cache TẦNG DATA (không `export const revalidate`)?
 *   `(app)/layout.tsx` đọc session (headers) → ép mọi route con sang dynamic
 *   (Next 15, PPR off) → revalidate ở page VÔ TÁC DỤNG. Nhưng đây là DATA công
 *   khai (giống mọi visitor, không userId) nên cache ở tầng DATA: kết quả query
 *   lưu + chia sẻ giữa request → cắt DB round-trip, vẫn chạy dù route render động.
 *   Web-only (mobile không dùng). Cache qua lớp Redis `cached()` (xem cache-aside.ts).
 */
import { and, count, desc, isNull, sql } from 'drizzle-orm';

// dbReplica: catalog công khai, read thuần → route replica (fallback primary).
import { dbReplica, libraryCourse, libraryUniversity } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

/**
 * Bản CACHE Redis (cache-aside, TTL 3600s) — thay `unstable_cache` cũ.
 * Có invalidation thật: `onLibraryCatalogChanged` xoá key khi docCount trường/môn
 * đổi (api/library/docs/finalize). Không field Date → serialize an toàn tuyệt đối.
 */
export async function getUniversitiesDirectory() {
  return cached(ck.universities(), 3600, async () => {
    const [universities, courseCounts, generalCourses] = await Promise.all([
      dbReplica
        .select({
          id: libraryUniversity.id,
          name: libraryUniversity.name,
          shortName: libraryUniversity.shortName,
          docCount: libraryUniversity.docCount,
        })
        .from(libraryUniversity)
        .where(sql`${libraryUniversity.docCount} > 0`)
        .orderBy(desc(libraryUniversity.docCount)),
      // Số môn (có doc) theo từng trường
      dbReplica
        .select({ universityId: libraryCourse.universityId, n: count() })
        .from(libraryCourse)
        .where(sql`${libraryCourse.docCount} > 0`)
        .groupBy(libraryCourse.universityId),
      // Môn chung (không thuộc trường)
      dbReplica
        .select({
          id: libraryCourse.id,
          name: libraryCourse.name,
          code: libraryCourse.code,
          docCount: libraryCourse.docCount,
        })
        .from(libraryCourse)
        .where(and(sql`${libraryCourse.docCount} > 0`, isNull(libraryCourse.universityId)))
        .orderBy(desc(libraryCourse.docCount)),
    ]);

    const courseCountMap = new Map(
      courseCounts
        .filter((r) => r.universityId)
        .map((r) => [r.universityId as string, Number(r.n)]),
    );
    const unis = universities.map((u) => ({
      ...u,
      courseCount: courseCountMap.get(u.id) ?? 0,
    }));

    return { unis, generalCourses };
  });
}
