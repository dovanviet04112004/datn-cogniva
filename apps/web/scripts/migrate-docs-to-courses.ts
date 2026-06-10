/**
 * Migrate docs → University/Course model (migration 0053 follow-up, 2026-05-27).
 *
 * One-time + idempotent:
 *   1. Seed ~10 trường đại học VN lớn (pool autocomplete cho upload).
 *   2. Với mỗi doc PUBLISHED chưa có course_id: derive tên course từ
 *      SUBJECT_BY_SLUG[subject].name + grade (K-12) hoặc subject name (ADULT/UNI),
 *      upsert course general (university=null), set doc.course_id +
 *      course_name_cache, recompute course.doc_count.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/migrate-docs-to-courses.ts
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  db,
  libraryCourse,
  libraryDoc,
  libraryUniversity,
} from '@cogniva/db';
import { SUBJECT_BY_SLUG } from '@cogniva/db/taxonomy';

// Trường VN lớn — seed pool cho autocomplete (chưa cần doc).
const SEED_UNIVERSITIES: Array<{ slug: string; name: string; shortName: string }> = [
  { slug: 'hust', name: 'Đại học Bách Khoa Hà Nội', shortName: 'HUST' },
  { slug: 'vnu-uet', name: 'Trường ĐH Công nghệ - ĐHQGHN', shortName: 'VNU-UET' },
  { slug: 'hcmut', name: 'Đại học Bách Khoa TP.HCM', shortName: 'HCMUT' },
  { slug: 'uit', name: 'Trường ĐH Công nghệ Thông tin - ĐHQG HCM', shortName: 'UIT' },
  { slug: 'neu', name: 'Đại học Kinh tế Quốc dân', shortName: 'NEU' },
  { slug: 'ftu', name: 'Đại học Ngoại thương', shortName: 'FTU' },
  { slug: 'ptit', name: 'Học viện Công nghệ Bưu chính Viễn thông', shortName: 'PTIT' },
  { slug: 'hcmus', name: 'Trường ĐH Khoa học Tự nhiên - ĐHQG HCM', shortName: 'HCMUS' },
  { slug: 'ump', name: 'Đại học Y Dược TP.HCM', shortName: 'UMP' },
  { slug: 'hlu', name: 'Đại học Luật Hà Nội', shortName: 'HLU' },
];

/** Tạo course name + slug từ subject + grade. */
function deriveCourse(subjectSlug: string, grade: number | null): {
  name: string;
  slug: string;
} {
  const subjName = SUBJECT_BY_SLUG[subjectSlug]?.name ?? subjectSlug;
  const name = grade ? `${subjName} ${grade}` : subjName;
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { name, slug };
}

async function main() {
  // 1. Seed universities (idempotent)
  for (const u of SEED_UNIVERSITIES) {
    await db
      .insert(libraryUniversity)
      .values({ slug: u.slug, name: u.name, shortName: u.shortName })
      .onConflictDoNothing({ target: libraryUniversity.slug });
  }
  console.log(`✅ Seeded ${SEED_UNIVERSITIES.length} universities`);

  // 2. Docs chưa có course
  const docs = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      grade: libraryDoc.grade,
    })
    .from(libraryDoc)
    .where(isNull(libraryDoc.courseId));

  console.log(`Found ${docs.length} docs cần gán course`);

  // Cache course theo slug để không query lặp
  const courseBySlug = new Map<string, string>();

  for (const doc of docs) {
    const { name, slug } = deriveCourse(doc.subjectSlug, doc.grade);

    let courseId = courseBySlug.get(slug);
    if (!courseId) {
      // Upsert course general (university=null). Unique (coalesce(uni,''), slug).
      const [existing] = await db
        .select({ id: libraryCourse.id })
        .from(libraryCourse)
        .where(and(isNull(libraryCourse.universityId), eq(libraryCourse.slug, slug)))
        .limit(1);
      if (existing) {
        courseId = existing.id;
      } else {
        const [created] = await db
          .insert(libraryCourse)
          .values({ name, slug, subjectArea: doc.subjectSlug })
          .returning({ id: libraryCourse.id });
        courseId = created!.id;
      }
      courseBySlug.set(slug, courseId);
    }

    await db
      .update(libraryDoc)
      .set({ courseId, courseNameCache: name })
      .where(eq(libraryDoc.id, doc.id));
  }

  // 3. Recompute doc_count mỗi course
  await db.execute(sql`
    UPDATE library_course c
    SET doc_count = (
      SELECT COUNT(*) FROM library_doc d
      WHERE d.course_id = c.id AND d.status = 'PUBLISHED'
    )
  `);

  console.log(`✅ Migrated ${docs.length} docs → ${courseBySlug.size} courses`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
