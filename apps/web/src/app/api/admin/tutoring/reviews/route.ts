/**
 * GET /api/admin/tutoring/reviews — list reviews cross-tutor.
 *
 * Query params:
 *   visibility — 'visible' (default) | 'hidden' | 'all'
 *   rating     — 1..5 (filter exact)
 *   q          — substring trên comment hoặc tutor/reviewer email
 *   cursor     — createdAt ISO
 *   limit      — default 50, max 100
 */
import { NextResponse } from 'next/server';
import { aliasedTable, and, desc, eq, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import {
  db,
  tutorProfile,
  tutorReview,
  user,
} from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

const tutorUser = aliasedTable(user, 'tutor_u');
const reviewerUser = aliasedTable(user, 'reviewer_u');

export async function GET(request: Request) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const visibility = url.searchParams.get('visibility') ?? 'visible';
  const ratingRaw = Number(url.searchParams.get('rating'));
  const rating = Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
    ? Math.floor(ratingRaw)
    : null;
  const q = url.searchParams.get('q')?.trim() ?? '';
  const cursor = url.searchParams.get('cursor');
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : 50;

  const conditions = [] as Parameters<typeof and>[number][];
  if (visibility === 'visible') conditions.push(isNull(tutorReview.hiddenAt));
  else if (visibility === 'hidden') conditions.push(isNotNull(tutorReview.hiddenAt));
  if (rating !== null) conditions.push(eq(tutorReview.rating, rating));
  if (q) {
    conditions.push(
      or(
        ilike(tutorReview.comment, `%${q}%`),
        ilike(tutorUser.email, `%${q}%`),
        ilike(reviewerUser.email, `%${q}%`),
      )!,
    );
  }
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) {
      conditions.push(lt(tutorReview.createdAt, parsed));
    }
  }

  const rows = await db
    .select({
      id: tutorReview.id,
      bookingId: tutorReview.bookingId,
      rating: tutorReview.rating,
      comment: tutorReview.comment,
      createdAt: tutorReview.createdAt,
      hiddenAt: tutorReview.hiddenAt,
      hiddenReason: tutorReview.hiddenReason,
      hiddenBy: tutorReview.hiddenBy,
      tutorProfileId: tutorReview.tutorId,
      tutorUserId: tutorProfile.userId,
      tutorName: tutorUser.name,
      tutorEmail: tutorUser.email,
      reviewerId: tutorReview.reviewerId,
      reviewerName: reviewerUser.name,
      reviewerEmail: reviewerUser.email,
      reviewerImage: reviewerUser.image,
    })
    .from(tutorReview)
    .leftJoin(tutorProfile, eq(tutorProfile.id, tutorReview.tutorId))
    .leftJoin(tutorUser, eq(tutorUser.id, tutorProfile.userId))
    .leftJoin(reviewerUser, eq(reviewerUser.id, tutorReview.reviewerId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tutorReview.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && trimmed.length > 0
      ? trimmed[trimmed.length - 1]!.createdAt.toISOString()
      : null;

  // Hidden count for badge
  const [hiddenCount] = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM "tutor_review" WHERE hidden_at IS NOT NULL`,
  );

  return NextResponse.json({
    reviews: trimmed.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      hiddenAt: r.hiddenAt?.toISOString() ?? null,
    })),
    nextCursor,
    hiddenCount: Number(hiddenCount?.n ?? 0),
  });
}
