/**
 * tutor-detail-resolver — V5.1 (2026-05-22).
 *
 * Resolve "tutorRef" fragment từ planner thành tutor cụ thể trong DB.
 * Pattern: ưu tiên tutor đã shown trong thread (context-aware), fuzzy
 * match theo tên user. Fallback global search nếu không tìm thấy.
 *
 * Sau khi resolve → fetch tutor profile + N reviews mới nhất + stats.
 */
import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import {
  db,
  tutorProfile,
  tutorReview,
  user as userTable,
} from '@cogniva/db';

export type TutorDetailPayload = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string;
  hourlyRateVnd: number;
  modality: string;
  ratingAvg: number | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  trialSessionEnabled: boolean;
  instantBookEnabled: boolean;
  avgResponseMinutes: number | null;
  /** Top N review mới nhất. */
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    tags: string[];
    helpfulCount: number;
    createdAt: Date;
    reviewerName: string | null;
  }>;
};

/**
 * Resolve tutor reference từ context thread + fuzzy name match.
 *
 * @param tutorRef User-typed fragment, vd "cô Mai", "thầy David", "tutor số 2"
 * @param shownTutorIds Tutor IDs đã hiển thị trong thread (ưu tiên match)
 */
export async function resolveTutorDetail({
  tutorRef,
  shownTutorIds,
  reviewLimit = 5,
}: {
  tutorRef: string;
  shownTutorIds: string[];
  reviewLimit?: number;
}): Promise<TutorDetailPayload | null> {
  // ── Step 1: Extract name fragment ────────────────────────────────
  // Strip honorifics + filler words để fuzzy match đúng tên
  const cleanedRef = tutorRef
    .replace(/^(cô|thầy|chị|anh|tutor|gia sư|gs|teacher|mr\.|mrs\.|ms\.)\s+/iu, '')
    .replace(/\s+(số\s+\d+|#\d+|thứ\s+\w+)$/iu, '')
    .trim();

  // ── Step 2: Tutor "tutor số N" — match theo position trong shown list ──
  const posMatch = tutorRef.match(/(?:số|thứ|#)\s*(\d+)/iu);
  if (posMatch && shownTutorIds.length > 0) {
    const idx = parseInt(posMatch[1] ?? '0', 10) - 1;
    if (idx >= 0 && idx < shownTutorIds.length) {
      const id = shownTutorIds[idx];
      if (id) return fetchTutorDetail(id, reviewLimit);
    }
  }

  // ── Step 3: Fuzzy match trong shown list trước (context-aware) ────
  if (shownTutorIds.length > 0 && cleanedRef.length >= 2) {
    const candidates = await db
      .select({ id: tutorProfile.id, name: userTable.name })
      .from(tutorProfile)
      .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
      .where(
        and(
          inArray(tutorProfile.id, shownTutorIds),
          or(
            ilike(userTable.name, `%${cleanedRef}%`),
            ilike(tutorProfile.headline, `%${cleanedRef}%`),
          ),
        ),
      )
      .limit(1);
    if (candidates[0]) return fetchTutorDetail(candidates[0].id, reviewLimit);
  }

  // ── Step 4: Global fuzzy match (toàn DB) — fallback ──────────────
  if (cleanedRef.length >= 2) {
    const global = await db
      .select({ id: tutorProfile.id })
      .from(tutorProfile)
      .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
      .where(
        and(
          eq(tutorProfile.status, 'PUBLISHED'),
          or(
            ilike(userTable.name, `%${cleanedRef}%`),
            ilike(tutorProfile.headline, `%${cleanedRef}%`),
          ),
        ),
      )
      .orderBy(desc(tutorProfile.ratingAvg))
      .limit(1);
    if (global[0]) return fetchTutorDetail(global[0].id, reviewLimit);
  }

  return null;
}

async function fetchTutorDetail(
  id: string,
  reviewLimit: number,
): Promise<TutorDetailPayload | null> {
  const [tutorRow] = await db
    .select({
      id: tutorProfile.id,
      name: userTable.name,
      avatarUrl: tutorProfile.avatarUrl,
      headline: tutorProfile.headline,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      modality: tutorProfile.modality,
      ratingAvg: tutorProfile.ratingAvg,
      ratingCount: tutorProfile.ratingCount,
      sessionsCompleted: tutorProfile.sessionsCompleted,
      verificationStatus: tutorProfile.verificationStatus,
      trialSessionEnabled: tutorProfile.trialSessionEnabled,
      instantBookEnabled: tutorProfile.instantBookEnabled,
      avgResponseMinutes: tutorProfile.avgResponseMinutes,
    })
    .from(tutorProfile)
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!tutorRow) return null;

  const reviews = await db
    .select({
      id: tutorReview.id,
      rating: tutorReview.rating,
      comment: tutorReview.comment,
      tags: tutorReview.tags,
      helpfulCount: tutorReview.helpfulCount,
      createdAt: tutorReview.createdAt,
      reviewerName: userTable.name,
    })
    .from(tutorReview)
    .innerJoin(userTable, eq(userTable.id, tutorReview.reviewerId))
    .where(and(eq(tutorReview.tutorId, id), isNull(tutorReview.hiddenAt)))
    .orderBy(desc(tutorReview.helpfulCount), desc(tutorReview.createdAt))
    .limit(reviewLimit);

  return {
    ...tutorRow,
    ratingAvg: tutorRow.ratingAvg ? Number(tutorRow.ratingAvg) : null,
    reviews: reviews.map((r) => ({
      ...r,
      tags: r.tags ?? [],
    })),
  };
}
