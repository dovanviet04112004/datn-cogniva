import { and, count, desc, isNull, sql } from 'drizzle-orm';

import { dbReplica, libraryCourse, libraryUniversity } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

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
      dbReplica
        .select({ universityId: libraryCourse.universityId, n: count() })
        .from(libraryCourse)
        .where(sql`${libraryCourse.docCount} > 0`)
        .groupBy(libraryCourse.universityId),
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
