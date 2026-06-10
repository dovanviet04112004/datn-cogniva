/**
 * POST /api/library/docs/finalize — Library V1 (2026-05-22).
 *
 * Step 2 upload flow: sau khi client PUT file lên R2 thành công, gọi finalize
 * với docId + metadata đầy đủ (title/desc/subject/level/grade/...).
 *
 * Server:
 *   1. UPDATE libraryDoc với metadata + file_url
 *   2. Trigger ingest pipeline ASYNC (không await — return response ngay)
 *   3. Return docId để client navigate sang detail page (status=PROCESSING)
 *
 * Ingest chạy background: parse + chunk + embed + AI summary → UPDATE status=PUBLISHED.
 *
 * Spec: docs/plans/library-share.md §Upload Flow.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, libraryCourse, libraryDoc, libraryUniversity } from '@cogniva/db';
import { sql } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { onLibraryCatalogChanged } from '@/lib/cache/invalidate';
import { ingestLibraryDoc } from '@/lib/library/ingest';
import { getPublicUrl } from '@/lib/r2-client';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min cho ingest

const BODY = z.object({
  docId: z.string().min(1),
  storageKey: z.string().min(1),
  title: z.string().min(5).max(200),
  description: z.string().max(2000).optional(),
  /** Course-first model: courseId là cách phân loại chính. subjectSlug optional
   *  (legacy/fallback, derive từ course.subjectArea nếu thiếu). */
  courseId: z.string().optional(),
  subjectSlug: z.string().optional(),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  grade: z.number().int().min(1).max(12).optional(),
  docType: z
    .enum([
      'lecture_notes',
      'summary',
      'exam',
      'exercise',
      'solution',
      'reference_book',
      'thesis',
      'handout',
      'mind_map',
      'other',
    ])
    .default('other'),
  examType: z
    .enum(['midterm', 'final', 'graduation', 'university_entrance', 'gifted_student'])
    .optional(),
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
  region: z.string().default('national'),
  language: z.enum(['vi', 'en']).default('vi'),
  tags: z.array(z.string().min(1).max(40)).max(10).default([]),
  license: z.enum(['CC-BY-4.0', 'PUBLIC_DOMAIN', 'MINE_ONLY']).default('CC-BY-4.0'),
  /** User xác nhận quyền chia sẻ — bắt buộc tick. */
  licenseConfirmed: z.literal(true),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { docId, storageKey, ...metadata } = parsed.data;

  // ── Verify ownership + status ──────────────────────────────────────
  const [doc] = await db
    .select()
    .from(libraryDoc)
    .where(
      and(eq(libraryDoc.id, docId), eq(libraryDoc.uploaderId, session.user.id)),
    )
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Resolve course (University→Course model) ───────────────────────
  // courseId → lấy university_id + course_name_cache + subject_area fallback.
  let courseId: string | null = null;
  let universityId: string | null = null;
  let courseNameCache: string | null = null;
  let universityNameCache: string | null = null;
  let subjectSlug = metadata.subjectSlug ?? 'other';
  if (metadata.courseId) {
    const [course] = await db
      .select()
      .from(libraryCourse)
      .where(eq(libraryCourse.id, metadata.courseId))
      .limit(1);
    if (course) {
      courseId = course.id;
      universityId = course.universityId;
      courseNameCache = course.code ? `${course.code} ${course.name}` : course.name;
      if (!metadata.subjectSlug && course.subjectArea) subjectSlug = course.subjectArea;
      // Tên trường vào search_vec (search "hust" ra doc của trường).
      if (universityId) {
        const [uni] = await db
          .select({ name: libraryUniversity.name, shortName: libraryUniversity.shortName })
          .from(libraryUniversity)
          .where(eq(libraryUniversity.id, universityId))
          .limit(1);
        if (uni) universityNameCache = `${uni.shortName ?? ''} ${uni.name}`.trim();
      }
    }
  }

  // ── UPDATE doc với metadata + file_url ─────────────────────────────
  const fileUrl = getPublicUrl(storageKey);
  await db
    .update(libraryDoc)
    .set({
      title: metadata.title,
      description: metadata.description ?? null,
      subjectSlug,
      courseId,
      universityId,
      courseNameCache,
      universityNameCache,
      level: metadata.level,
      grade: metadata.grade ?? null,
      docType: metadata.docType,
      examType: metadata.examType ?? null,
      schoolYear: metadata.schoolYear ?? null,
      region: metadata.region,
      language: metadata.language,
      tags: metadata.tags,
      license: metadata.license,
      fileUrl,
      updatedAt: new Date(),
    })
    .where(eq(libraryDoc.id, docId));

  // ── Increment doc_count cho course + university (best-effort) ──────
  if (courseId) {
    void db
      .update(libraryCourse)
      .set({ docCount: sql`${libraryCourse.docCount} + 1` })
      .where(eq(libraryCourse.id, courseId))
      .catch(() => {});
  }
  if (universityId) {
    void db
      .update(libraryUniversity)
      .set({ docCount: sql`${libraryUniversity.docCount} + 1` })
      .where(eq(libraryUniversity.id, universityId))
      .catch(() => {});
  }

  // docCount trường/môn đổi (hoặc doc mới vượt ngưỡng >0) → directory catalog
  // công khai đã cũ. Bust cache (fail-open). Gọi 1 lần phủ cả course+university.
  await onLibraryCatalogChanged();

  // ── Trigger ingest ASYNC (không await — long-running) ──────────────
  // Lưu ý: Next.js serverless không có background workers; ta dùng fetch self
  // hoặc đơn giản chạy promise và return ngay. Phase 2 sẽ wrap qua BullMQ job.
  void ingestLibraryDoc(docId).catch(async (err) => {
    console.error('[library.ingest.fail]', docId, err);
    await db
      .update(libraryDoc)
      .set({ status: 'PROCESSING', hiddenReason: `Ingest fail: ${(err as Error).message}` })
      .where(eq(libraryDoc.id, docId));
  });

  return NextResponse.json({
    docId,
    status: 'PROCESSING',
    message: 'Đang xử lý tài liệu (parse + embed). Tự refresh sau 30s sẽ thấy PUBLISHED.',
  });
}
