/**
 * GET  /api/library/docs/[id] — detail của 1 doc (full metadata + reviews preview).
 * DELETE /api/library/docs/[id] — owner xoá (set status=HIDDEN, không hard delete).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';

import { randomUUID } from 'node:crypto';

import {
  db,
  dbReplica,
  libraryDoc,
  libraryDocReview,
  libraryDocView,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached, cacheVersion } from '@/lib/cache/cache-aside';
import { ck, TAG_LIBRARY } from '@/lib/cache/keys';
import { onLibraryCatalogChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  // ── Doc + top reviews: CACHE version-fold (public, nhiều-key theo id) ───
  // Nội dung detail chung mọi visitor (không phụ thuộc session) → cache đơn 1
  // object {doc, reviews}. Key gắn `ver` từ cacheVersion(TAG_LIBRARY); doc
  // finalize/import-catalog đổi → onLibraryCatalogChanged bump version → key cũ
  // mồ côi. dbReplica: read công khai thuần. TTL 600s = lưới an toàn cuối.
  // ratingAvg/qualityScore normalize về number TRONG fetchFn để cache đúng shape.
  // KHÔNG có Date được consumer dùng kiểu Date (chỉ NextResponse.json) → để string.
  const ver = await cacheVersion(TAG_LIBRARY);
  const detail = await cached(ck.libraryDocDetail(id, ver), 600, async () => {
    const [docRow] = await dbReplica
      .select({
        id: libraryDoc.id,
        uploaderId: libraryDoc.uploaderId,
        uploaderName: userTable.name,
        uploaderImage: userTable.image,
        title: libraryDoc.title,
        description: libraryDoc.description,
        subjectSlug: libraryDoc.subjectSlug,
        level: libraryDoc.level,
        grade: libraryDoc.grade,
        docType: libraryDoc.docType,
        examType: libraryDoc.examType,
        schoolYear: libraryDoc.schoolYear,
        region: libraryDoc.region,
        language: libraryDoc.language,
        tags: libraryDoc.tags,
        fileFormat: libraryDoc.fileFormat,
        fileSizeBytes: libraryDoc.fileSizeBytes,
        pageCount: libraryDoc.pageCount,
        previewThumbUrl: libraryDoc.previewThumbUrl,
        aiSummary: libraryDoc.aiSummary,
        previewText: libraryDoc.previewText,
        license: libraryDoc.license,
        status: libraryDoc.status,
        viewCount: libraryDoc.viewCount,
        downloadCount: libraryDoc.downloadCount,
        workspaceImportCount: libraryDoc.workspaceImportCount,
        ratingAvg: libraryDoc.ratingAvg,
        ratingCount: libraryDoc.ratingCount,
        qualityScore: libraryDoc.qualityScore,
        badges: libraryDoc.badges,
        createdAt: libraryDoc.createdAt,
      })
      .from(libraryDoc)
      .leftJoin(userTable, eq(userTable.id, libraryDoc.uploaderId))
      .where(eq(libraryDoc.id, id))
      .limit(1);

    if (!docRow) return null;

    // Fetch top 5 review (helpful + recent)
    const reviews = await dbReplica
      .select({
        id: libraryDocReview.id,
        rating: libraryDocReview.rating,
        comment: libraryDocReview.comment,
        helpfulCount: libraryDocReview.helpfulCount,
        createdAt: libraryDocReview.createdAt,
        reviewerName: userTable.name,
        reviewerImage: userTable.image,
      })
      .from(libraryDocReview)
      .innerJoin(userTable, eq(userTable.id, libraryDocReview.reviewerId))
      .where(eq(libraryDocReview.docId, id))
      .orderBy(desc(libraryDocReview.helpfulCount), desc(libraryDocReview.createdAt))
      .limit(5);

    return {
      doc: {
        ...docRow,
        ratingAvg: docRow.ratingAvg ? Number(docRow.ratingAvg) : null,
        qualityScore: docRow.qualityScore ? Number(docRow.qualityScore) : null,
      },
      reviews,
    };
  });

  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Tracking writes: NGOÀI cache, fire-and-forget (db primary) ─────────
  // viewCount++ + per-user "Vừa xem" history KHÔNG được nằm trong fetchFn cache
  // (chỉ chạy khi MISS → đếm sai); để ngoài, chạy mỗi request, không await.
  void db
    .update(libraryDoc)
    .set({ viewCount: sql`${libraryDoc.viewCount} + 1` })
    .where(eq(libraryDoc.id, id))
    .catch(() => {});

  // Per-user view upsert — Phase 4 "Vừa xem" tracking
  if (session?.user.id) {
    void db
      .insert(libraryDocView)
      .values({
        id: randomUUID(),
        userId: session.user.id,
        docId: id,
        viewedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [libraryDocView.userId, libraryDocView.docId],
        set: { viewedAt: new Date() },
      })
      .catch(() => {});
  }

  return NextResponse.json(detail);
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [doc] = await db
    .select({ uploaderId: libraryDoc.uploaderId })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.uploaderId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db
    .update(libraryDoc)
    .set({
      status: 'HIDDEN',
      hiddenAt: new Date(),
      hiddenReason: 'Removed by uploader',
    })
    .where(and(eq(libraryDoc.id, id), eq(libraryDoc.uploaderId, session.user.id)));

  // Doc ẩn (HIDDEN) → bump version để mọi cache version-fold (feed + detail) hết
  // trỏ tới nó (chống xem doc đã xoá qua cache tới 10 phút).
  await onLibraryCatalogChanged();
  return NextResponse.json({ ok: true });
}
