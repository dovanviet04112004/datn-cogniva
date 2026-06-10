/**
 * get-catalog-detail — chi tiết trường/môn library theo id (server-only).
 *
 * Tách query inline khỏi 2 trang chi tiết (`university/[id]`, `course/[id]`) để
 * cache được. Đây là dữ liệu CÔNG KHAI NHIỀU-KEY (mỗi id 1 key) → dùng VERSION-FOLD:
 * key gắn `ver` lấy từ `cacheVersion(TAG_LIBRARY)`. Khi catalog đổi (doc finalize)
 * `onLibraryCatalogChanged` gọi `bumpCacheVersion(TAG_LIBRARY)` → mọi key chi tiết
 * cũ thành mồ côi (không cần enumerate id để xoá). Không field Date → serialize an toàn.
 *
 * dbReplica: read công khai thuần → route replica (fallback primary).
 */
import { and, count, desc, eq, sql } from 'drizzle-orm';

import { dbReplica, libraryCourse, libraryDoc, libraryUniversity } from '@cogniva/db';

import { cached, cacheVersion } from '@/lib/cache/cache-aside';
import { ck, TAG_LIBRARY } from '@/lib/cache/keys';

/** Chi tiết 1 trường + danh sách môn (có doc) + breakdown loại tài liệu. */
export async function getUniversityDetail(id: string) {
  const ver = await cacheVersion(TAG_LIBRARY);
  return cached(ck.universityDetail(id, ver), 3600, async () => {
    const [uni] = await dbReplica
      .select({
        id: libraryUniversity.id,
        name: libraryUniversity.name,
        shortName: libraryUniversity.shortName,
        docCount: libraryUniversity.docCount,
      })
      .from(libraryUniversity)
      .where(eq(libraryUniversity.id, id))
      .limit(1);

    if (!uni) return null;

    const [courses, docTypeBreakdown] = await Promise.all([
      dbReplica
        .select({
          id: libraryCourse.id,
          name: libraryCourse.name,
          code: libraryCourse.code,
          docCount: libraryCourse.docCount,
        })
        .from(libraryCourse)
        .where(and(eq(libraryCourse.universityId, id), sql`${libraryCourse.docCount} > 0`))
        .orderBy(desc(libraryCourse.docCount))
        .limit(200),
      dbReplica
        .select({ docType: libraryDoc.docType, n: count() })
        .from(libraryDoc)
        .where(and(eq(libraryDoc.universityId, id), eq(libraryDoc.status, 'PUBLISHED')))
        .groupBy(libraryDoc.docType)
        .orderBy(desc(count())),
    ]);

    return { uni, courses, docTypeBreakdown };
  });
}

/** Chi tiết 1 môn (kèm tên trường qua leftJoin). */
export async function getCourseDetail(id: string) {
  const ver = await cacheVersion(TAG_LIBRARY);
  return cached(ck.courseDetail(id, ver), 3600, async () => {
    const [course] = await dbReplica
      .select({
        id: libraryCourse.id,
        name: libraryCourse.name,
        code: libraryCourse.code,
        docCount: libraryCourse.docCount,
        universityId: libraryCourse.universityId,
        universityName: libraryUniversity.name,
        universityShort: libraryUniversity.shortName,
      })
      .from(libraryCourse)
      .leftJoin(libraryUniversity, eq(libraryUniversity.id, libraryCourse.universityId))
      .where(eq(libraryCourse.id, id))
      .limit(1);

    return course ?? null;
  });
}
