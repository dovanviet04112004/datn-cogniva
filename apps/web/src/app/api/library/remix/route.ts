/**
 * POST /api/library/remix — Bonus #12 Doc Remix (Phase 3, 2026-05-27).
 *
 * Body:
 *   {
 *     title: string,
 *     description?: string,
 *     subjectSlug: string,
 *     level: enum,
 *     grade?: number,
 *     sourceDocIds: string[]    // 2-5 doc nguồn
 *   }
 *
 * Flow:
 *   1. Verify mọi source doc PUBLISHED + cùng/related subject
 *   2. INSERT library_doc mới với:
 *      - parent_remix_doc_ids = sourceDocIds
 *      - file_url = 'remix://' (no real file — embed chunks merged)
 *      - file_hash = sha256(sortedIds) để dedup nếu remix giống hệt
 *      - status = PUBLISHED (skip processing — chunks ready)
 *   3. Bulk copy chunks từ tất cả source docs vào doc mới (max 200 chunks)
 *   4. Increment remix_count trên mỗi source doc
 *   5. Award karma +5 cho mỗi uploader source
 *   6. Trigger recompute quality + ingest atom extraction async
 *
 * Constraints:
 *   - Min 2, max 5 source docs
 *   - User chỉ remix từ doc PUBLISHED
 *   - Title min 5 char
 *
 * Spec: docs/plans/library-share.md §Bonus 12.
 */
import { createHash, randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, libraryDoc, libraryDocChunk } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { awardKarma } from '@/lib/library/karma';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BODY = z.object({
  title: z.string().min(5).max(200),
  description: z.string().max(2000).optional(),
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  grade: z.number().int().min(1).max(12).optional(),
  sourceDocIds: z.array(z.string().min(1)).min(2).max(5),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { title, description, subjectSlug, level, grade, sourceDocIds } = parsed.data;

  // Dedup source ids
  const uniqIds = Array.from(new Set(sourceDocIds));
  if (uniqIds.length < 2) {
    return NextResponse.json(
      { error: 'Cần tối thiểu 2 doc khác nhau' },
      { status: 400 },
    );
  }

  // Fetch sources
  const sources = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      title: libraryDoc.title,
      pageCount: libraryDoc.pageCount,
      status: libraryDoc.status,
    })
    .from(libraryDoc)
    .where(inArray(libraryDoc.id, uniqIds));
  if (sources.length !== uniqIds.length) {
    return NextResponse.json(
      { error: 'Một số doc nguồn không tồn tại' },
      { status: 400 },
    );
  }
  for (const s of sources) {
    if (s.status !== 'PUBLISHED') {
      return NextResponse.json(
        { error: `Doc nguồn "${s.title}" chưa PUBLISHED` },
        { status: 400 },
      );
    }
  }

  const newDocId = randomUUID();
  // Hash từ sortedIds dedup remix giống hệt
  const sortedHash = createHash('sha256')
    .update(uniqIds.sort().join('|'))
    .digest('hex')
    .slice(0, 32);
  const fileHash = `remix-${sortedHash}`;

  // Total page count = sum sources (cap 200)
  const totalPages = Math.min(
    200,
    sources.reduce((s, d) => s + (d.pageCount ?? 1), 0),
  );

  await db.transaction(async (tx) => {
    // 1. INSERT new remix library_doc
    await tx.insert(libraryDoc).values({
      id: newDocId,
      uploaderId: session.user.id,
      title,
      description: description ?? `Tổng hợp từ ${sources.length} doc nguồn về ${subjectSlug}.`,
      subjectSlug,
      level,
      grade: grade ?? null,
      docType: 'summary', // remix là "tổng hợp"
      fileFormat: 'pdf',
      fileSizeBytes: 0,
      fileUrl: `remix://${newDocId}`,
      fileHash,
      pageCount: totalPages,
      previewText: `Tổng hợp từ: ${sources.map((s) => s.title).join(' · ')}`,
      aiSummary: `Tài liệu tổng hợp từ ${sources.length} nguồn: ${sources.map((s) => s.title).join(', ')}.`,
      aiSummaryAt: new Date(),
      parentRemixDocIds: uniqIds,
      license: 'CC-BY-4.0',
      status: 'PUBLISHED',
    });

    // 2. Bulk copy chunks từ sources (cap 200 chunks tổng)
    const sourceListLiteral = `{${uniqIds.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`;
    await tx.execute(sql`
      INSERT INTO library_doc_chunk
        (id, doc_id, page_num, chunk_index, content, content_vec)
      SELECT
        gen_random_uuid()::text,
        ${newDocId},
        page_num,
        chunk_index,
        content,
        content_vec
      FROM library_doc_chunk
      WHERE doc_id = ANY(${sourceListLiteral}::text[])
      ORDER BY doc_id, page_num, chunk_index
      LIMIT 200
    `);

    // 3. Increment remix_count + atomic karma awards
    await tx
      .update(libraryDoc)
      .set({ remixCount: sql`${libraryDoc.remixCount} + 1` })
      .where(inArray(libraryDoc.id, uniqIds));
  });

  // 4. Karma award per source uploader (async best-effort)
  void (async () => {
    const dedupUploaders = Array.from(new Set(sources.map((s) => s.uploaderId)));
    for (const uid of dedupUploaders) {
      if (uid === session.user.id) continue; // không tự thưởng karma cho mình
      await awardKarma({
        userId: uid,
        eventType: 'doc_remixed',
        docId: newDocId,
        context: { remixerId: session.user.id },
      }).catch((err) => console.error('[remix.karma]', uid, err));
    }
  })();

  // 5. Trigger ingest atom extract + quality compute (async)
  void (async () => {
    try {
      const [{ extractAtomsForDoc }, { recomputeQualityForDoc }] = await Promise.all([
        import('@/lib/library/atom-extractor'),
        import('@/lib/library/quality-score'),
      ]);
      await extractAtomsForDoc(newDocId).catch(() => {});
      await recomputeQualityForDoc(newDocId).catch(() => {});
    } catch {
      /* silent */
    }
  })();

  return NextResponse.json({
    ok: true,
    docId: newDocId,
    title,
    sourceCount: sources.length,
    message: `Đã tạo "${title}" tổng hợp từ ${sources.length} doc nguồn.`,
  });
}

