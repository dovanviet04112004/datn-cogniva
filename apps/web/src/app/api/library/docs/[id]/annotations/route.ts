/**
 * Annotation endpoints (Bonus #8 Phase 3, 2026-05-27).
 *
 *   GET  /api/library/docs/[id]/annotations       — list public + own annotations
 *   POST /api/library/docs/[id]/annotations       — create new annotation
 *
 * Filter rules:
 *   - public visibility hiển thị cho mọi user
 *   - private chỉ author thấy
 *   - sort: helpful_count DESC, created_at DESC
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  libraryDoc,
  libraryDocAnnotation,
  libraryDocAnnotationVote,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const BODY = z.object({
  pageNum: z.number().int().min(1).max(10000),
  note: z.string().min(2).max(2000),
  visibility: z.enum(['public', 'private']).default('public'),
  /** Phase 4: text user highlight khi tạo note (optional). */
  selectedText: z.string().max(500).optional(),
  /** Pixel coords normalized 0..1 cho overlay highlight (optional). */
  selectionRect: z
    .object({
      pageW: z.number(),
      pageH: z.number(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;

  // Visible: public OR own
  const conds = [eq(libraryDocAnnotation.docId, id)];
  if (userId) {
    conds.push(
      or(
        eq(libraryDocAnnotation.visibility, 'public'),
        eq(libraryDocAnnotation.authorId, userId),
      )!,
    );
  } else {
    conds.push(eq(libraryDocAnnotation.visibility, 'public'));
  }

  const rows = await db
    .select({
      id: libraryDocAnnotation.id,
      pageNum: libraryDocAnnotation.pageNum,
      note: libraryDocAnnotation.note,
      selectedText: libraryDocAnnotation.selectedText,
      selectionRect: libraryDocAnnotation.selectionRect,
      visibility: libraryDocAnnotation.visibility,
      helpfulCount: libraryDocAnnotation.helpfulCount,
      createdAt: libraryDocAnnotation.createdAt,
      authorId: libraryDocAnnotation.authorId,
      authorName: userTable.name,
      authorImage: userTable.image,
      /** User đã vote helpful cho annotation này chưa */
      hasVoted: userId
        ? sql<boolean>`EXISTS(SELECT 1 FROM library_doc_annotation_vote v WHERE v.annotation_id = ${libraryDocAnnotation.id} AND v.user_id = ${userId})`
        : sql<boolean>`false`,
    })
    .from(libraryDocAnnotation)
    .leftJoin(userTable, eq(userTable.id, libraryDocAnnotation.authorId))
    .where(and(...conds))
    .orderBy(
      desc(libraryDocAnnotation.helpfulCount),
      desc(libraryDocAnnotation.createdAt),
    )
    .limit(100);

  return NextResponse.json({
    annotations: rows,
    total: rows.length,
    viewerId: userId,
  });
}

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  // Verify doc exists + PUBLISHED
  const [doc] = await db
    .select({ id: libraryDoc.id, status: libraryDoc.status, pageCount: libraryDoc.pageCount })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.status !== 'PUBLISHED') {
    return NextResponse.json({ error: 'Not available' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (doc.pageCount && parsed.data.pageNum > doc.pageCount) {
    return NextResponse.json(
      { error: `Doc chỉ có ${doc.pageCount} trang` },
      { status: 400 },
    );
  }

  const annotationId = randomUUID();
  await db.insert(libraryDocAnnotation).values({
    id: annotationId,
    docId: id,
    authorId: session.user.id,
    pageNum: parsed.data.pageNum,
    note: parsed.data.note,
    visibility: parsed.data.visibility,
    selectedText: parsed.data.selectedText ?? null,
    selectionRect: parsed.data.selectionRect ?? null,
  });

  return NextResponse.json({ ok: true, id: annotationId });
}
