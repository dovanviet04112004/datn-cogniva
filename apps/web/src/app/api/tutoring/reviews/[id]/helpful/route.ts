/**
 * POST /api/tutoring/reviews/[id]/helpful — V4 T5 (2026-05-22).
 *
 * Toggle "Hữu ích" cho 1 review. Idempotent — 1 user / review.
 * Update helpful_count cached qua transaction.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import {
  db,
  tutorReview,
  tutorReviewHelpful,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: reviewId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify review exists
  const [review] = await db
    .select({ id: tutorReview.id })
    .from(tutorReview)
    .where(eq(tutorReview.id, reviewId))
    .limit(1);
  if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

  // Toggle
  const [existing] = await db
    .select({ reviewId: tutorReviewHelpful.reviewId })
    .from(tutorReviewHelpful)
    .where(
      and(
        eq(tutorReviewHelpful.reviewId, reviewId),
        eq(tutorReviewHelpful.userId, session.user.id),
      ),
    )
    .limit(1);

  return db.transaction(async (tx) => {
    if (existing) {
      // Un-helpful
      await tx
        .delete(tutorReviewHelpful)
        .where(
          and(
            eq(tutorReviewHelpful.reviewId, reviewId),
            eq(tutorReviewHelpful.userId, session.user.id),
          ),
        );
      const [updated] = await tx
        .update(tutorReview)
        .set({ helpfulCount: sql`GREATEST(${tutorReview.helpfulCount} - 1, 0)` })
        .where(eq(tutorReview.id, reviewId))
        .returning({ count: tutorReview.helpfulCount });
      return NextResponse.json({ helpful: false, count: updated?.count ?? 0 });
    } else {
      await tx
        .insert(tutorReviewHelpful)
        .values({ reviewId, userId: session.user.id });
      const [updated] = await tx
        .update(tutorReview)
        .set({ helpfulCount: sql`${tutorReview.helpfulCount} + 1` })
        .where(eq(tutorReview.id, reviewId))
        .returning({ count: tutorReview.helpfulCount });
      return NextResponse.json({ helpful: true, count: updated?.count ?? 0 });
    }
  });
}
