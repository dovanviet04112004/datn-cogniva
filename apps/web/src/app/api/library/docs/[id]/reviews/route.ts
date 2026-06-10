/**
 * GET  /api/library/docs/[id]/reviews — list reviews + sort by helpful.
 * POST /api/library/docs/[id]/reviews — upsert review (1/user/doc).
 *
 * Sau POST: recompute rating_avg + rating_count atomic.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  libraryDoc,
  libraryDocReview,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const BODY = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export async function GET(request: Request, { params }: Params) {
  const { id: docId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;

  const rows = await db
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
    .where(eq(libraryDocReview.docId, docId))
    .orderBy(desc(libraryDocReview.helpfulCount), desc(libraryDocReview.createdAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({ reviews: rows });
}

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: docId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { rating, comment } = parsed.data;

  // Verify doc exists
  const [doc] = await db
    .select({ id: libraryDoc.id, uploaderId: libraryDoc.uploaderId })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.uploaderId === session.user.id) {
    return NextResponse.json(
      { error: 'Không thể tự review tài liệu của mình' },
      { status: 400 },
    );
  }

  // Upsert review + recompute aggregate trong txn
  await db.transaction(async (tx) => {
    // Check existing
    const [existing] = await tx
      .select({ id: libraryDocReview.id })
      .from(libraryDocReview)
      .where(
        and(
          eq(libraryDocReview.docId, docId),
          eq(libraryDocReview.reviewerId, session.user.id),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(libraryDocReview)
        .set({ rating, comment: comment ?? null })
        .where(eq(libraryDocReview.id, existing.id));
    } else {
      await tx.insert(libraryDocReview).values({
        docId,
        reviewerId: session.user.id,
        rating,
        comment: comment ?? null,
      });
    }

    // Recompute aggregate
    const [agg] = await tx
      .select({
        avg: sql<string>`AVG(${libraryDocReview.rating})::text`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(libraryDocReview)
      .where(eq(libraryDocReview.docId, docId));
    if (agg) {
      await tx
        .update(libraryDoc)
        .set({
          ratingAvg: agg.avg ? String(Number(agg.avg).toFixed(2)) : null,
          ratingCount: agg.count,
        })
        .where(eq(libraryDoc.id, docId));
    }
  });

  return NextResponse.json({ ok: true });
}
