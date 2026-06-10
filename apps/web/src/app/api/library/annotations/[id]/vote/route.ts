/**
 * POST /api/library/annotations/[id]/vote — toggle helpful vote (Bonus #8).
 *
 * Nếu user đã vote → unvote + decrement count.
 * Nếu chưa → INSERT vote + increment.
 *
 * Tránh race condition bằng transaction + unique constraint (annotation_id, user_id).
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import {
  db,
  libraryDocAnnotation,
  libraryDocAnnotationVote,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: annotationId } = await params;

  // Check annotation exists
  const [ann] = await db
    .select({ id: libraryDocAnnotation.id })
    .from(libraryDocAnnotation)
    .where(eq(libraryDocAnnotation.id, annotationId))
    .limit(1);
  if (!ann) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const result = await db.transaction(async (tx) => {
    // Check existing vote
    const [existing] = await tx
      .select({ id: libraryDocAnnotationVote.id })
      .from(libraryDocAnnotationVote)
      .where(
        and(
          eq(libraryDocAnnotationVote.annotationId, annotationId),
          eq(libraryDocAnnotationVote.userId, session.user.id),
        ),
      )
      .limit(1);

    if (existing) {
      // Unvote
      await tx
        .delete(libraryDocAnnotationVote)
        .where(eq(libraryDocAnnotationVote.id, existing.id));
      const [updated] = await tx
        .update(libraryDocAnnotation)
        .set({
          helpfulCount: sql`GREATEST(${libraryDocAnnotation.helpfulCount} - 1, 0)`,
        })
        .where(eq(libraryDocAnnotation.id, annotationId))
        .returning({ helpfulCount: libraryDocAnnotation.helpfulCount });
      return { voted: false, helpfulCount: updated?.helpfulCount ?? 0 };
    } else {
      // Vote
      await tx.insert(libraryDocAnnotationVote).values({
        id: randomUUID(),
        annotationId,
        userId: session.user.id,
      });
      const [updated] = await tx
        .update(libraryDocAnnotation)
        .set({
          helpfulCount: sql`${libraryDocAnnotation.helpfulCount} + 1`,
        })
        .where(eq(libraryDocAnnotation.id, annotationId))
        .returning({ helpfulCount: libraryDocAnnotation.helpfulCount });
      return { voted: true, helpfulCount: updated?.helpfulCount ?? 1 };
    }
  });

  return NextResponse.json(result);
}
