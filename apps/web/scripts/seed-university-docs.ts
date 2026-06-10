/**
 * Seed tài liệu đại học (University→Course model, 2026-05-27).
 *
 * Với mỗi doc trong fixtures/university-docs.ts:
 *   1. Tìm university theo slug (đã seed bởi migrate-docs-to-courses.ts)
 *   2. Find-or-create course (university-linked) theo slug
 *   3. Insert library_doc (PUBLISHED) với course_id + university_id + cache
 *   4. Render multi-page PDF + thumbnail → upload R2
 *   5. Recompute doc_count course + university
 *
 * Idempotent: skip doc đã tồn tại (theo title). Chạy lại an toàn.
 *
 * Usage: pnpm exec tsx --env-file=.env.local scripts/seed-university-docs.ts
 */
import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, libraryCourse, libraryDoc, libraryUniversity, user as userTable } from '@cogniva/db';

import { putR2Object, getPublicUrl } from '../src/lib/r2-client';
import { renderDocPdf, plainText, makeThumbnail } from './lib/pdf-render';
import { UNIVERSITY_DOCS } from './fixtures/university-docs';

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  const [seedUser] = await db.select({ id: userTable.id }).from(userTable).limit(1);
  if (!seedUser) throw new Error('Không có user để gán uploader');
  const uploaderId = seedUser.id;

  console.log(`📚 Seed ${UNIVERSITY_DOCS.length} tài liệu đại học...\n`);
  let created = 0, skipped = 0;
  const touchedCourses = new Set<string>();
  const touchedUnis = new Set<string>();

  for (let i = 0; i < UNIVERSITY_DOCS.length; i++) {
    const d = UNIVERSITY_DOCS[i]!;
    const tag = `[${i + 1}/${UNIVERSITY_DOCS.length}] ${d.title.slice(0, 50)}`;

    // Skip nếu doc đã tồn tại theo title
    const [exist] = await db
      .select({ id: libraryDoc.id })
      .from(libraryDoc)
      .where(eq(libraryDoc.title, d.title))
      .limit(1);
    if (exist) { console.log(`${tag}\n       ⊘ đã tồn tại — skip`); skipped++; continue; }

    try {
      // University
      const [uni] = await db
        .select({ id: libraryUniversity.id })
        .from(libraryUniversity)
        .where(eq(libraryUniversity.slug, d.universitySlug))
        .limit(1);
      const universityId = uni?.id ?? null;

      // Find-or-create course
      const courseSlug = slugify(d.courseName);
      let courseId: string;
      const [exCourse] = await db
        .select({ id: libraryCourse.id })
        .from(libraryCourse)
        .where(and(
          universityId ? eq(libraryCourse.universityId, universityId) : isNull(libraryCourse.universityId),
          eq(libraryCourse.slug, courseSlug),
        ))
        .limit(1);
      if (exCourse) {
        courseId = exCourse.id;
      } else {
        const [c] = await db.insert(libraryCourse).values({
          id: randomUUID(),
          universityId,
          code: d.courseCode,
          name: d.courseName,
          slug: courseSlug,
          subjectArea: d.subjectArea,
          createdBy: uploaderId,
        }).returning({ id: libraryCourse.id });
        courseId = c!.id;
      }
      touchedCourses.add(courseId);
      if (universityId) touchedUnis.add(universityId);

      const courseNameCache = `${d.courseCode} ${d.courseName}`;
      const docId = randomUUID();

      // Render PDF + thumbnail
      const pdfBuffer = await renderDocPdf(d.title, courseNameCache, d.blocks);
      const key = `lib/${uploaderId}/${docId}.pdf`;
      await putR2Object(key, pdfBuffer, 'application/pdf');
      const fileUrl = getPublicUrl(key);

      const { PDFDocument } = await import('pdf-lib');
      const pageCount = (await PDFDocument.load(pdfBuffer)).getPageCount();

      let thumbUrl: string | null = null;
      const thumb = await makeThumbnail(pdfBuffer);
      if (thumb) {
        const tkey = `lib/${uploaderId}/${docId}-thumb-real.jpg`;
        await putR2Object(tkey, thumb, 'image/jpeg');
        thumbUrl = getPublicUrl(tkey);
      }

      await db.insert(libraryDoc).values({
        id: docId,
        uploaderId,
        title: d.title,
        description: plainText(d.blocks).slice(0, 300),
        subjectSlug: d.subjectArea,
        courseId,
        universityId,
        courseNameCache,
        level: 'UNIVERSITY',
        grade: null,
        docType: d.docType,
        region: 'national',
        language: 'vi',
        tags: [d.courseName.toLowerCase(), d.courseCode.toLowerCase()],
        fileFormat: 'pdf',
        fileSizeBytes: pdfBuffer.length,
        fileUrl,
        fileHash: `seed-uni-${docId}`,
        pageCount,
        previewThumbUrl: thumbUrl,
        previewText: plainText(d.blocks),
        license: 'CC-BY-4.0',
        status: 'PUBLISHED',
        // Stats THẬT: bắt đầu từ 0 (không bịa số tương tác).
        ratingAvg: null,
        ratingCount: 0,
        viewCount: 0,
        downloadCount: 0,
        workspaceImportCount: 0,
        qualityScore: null,
        badges: [],
      });

      console.log(`${tag}\n       ✓ ${d.universitySlug} · ${d.courseCode} · ${pageCount} trang${thumbUrl ? ' · thumb ✓' : ''}`);
      created++;
    } catch (err) {
      console.log(`${tag}\n       ✗ ${(err as Error).message}`);
      skipped++;
    }
  }

  // Recompute doc_count
  await db.execute(sql`
    UPDATE library_course c SET doc_count = (
      SELECT COUNT(*) FROM library_doc d WHERE d.course_id = c.id AND d.status = 'PUBLISHED'
    )`);
  await db.execute(sql`
    UPDATE library_university u SET doc_count = (
      SELECT COUNT(*) FROM library_doc d WHERE d.university_id = u.id AND d.status = 'PUBLISHED'
    )`);

  console.log(`\n────────────\nCreated: ${created} · Skipped: ${skipped} · Courses: ${touchedCourses.size} · Universities: ${touchedUnis.size}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
