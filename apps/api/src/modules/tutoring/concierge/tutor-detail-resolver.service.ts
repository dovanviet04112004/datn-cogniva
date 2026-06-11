import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infra/database/prisma.service';

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

@Injectable()
export class TutorDetailResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTutorDetail({
    tutorRef,
    shownTutorIds,
    reviewLimit = 5,
  }: {
    tutorRef: string;
    shownTutorIds: string[];
    reviewLimit?: number;
  }): Promise<TutorDetailPayload | null> {
    const cleanedRef = tutorRef
      .replace(/^(cô|thầy|chị|anh|tutor|gia sư|gs|teacher|mr\.|mrs\.|ms\.)\s+/iu, '')
      .replace(/\s+(số\s+\d+|#\d+|thứ\s+\w+)$/iu, '')
      .trim();

    const posMatch = tutorRef.match(/(?:số|thứ|#)\s*(\d+)/iu);
    if (posMatch && shownTutorIds.length > 0) {
      const idx = parseInt(posMatch[1] ?? '0', 10) - 1;
      if (idx >= 0 && idx < shownTutorIds.length) {
        const id = shownTutorIds[idx];
        if (id) return this.fetchTutorDetail(id, reviewLimit);
      }
    }

    if (shownTutorIds.length > 0 && cleanedRef.length >= 2) {
      const candidate = await this.prisma.tutor_profile.findFirst({
        where: {
          id: { in: shownTutorIds },
          OR: [
            { user: { name: { contains: cleanedRef, mode: 'insensitive' } } },
            { headline: { contains: cleanedRef, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (candidate) return this.fetchTutorDetail(candidate.id, reviewLimit);
    }

    if (cleanedRef.length >= 2) {
      const global = await this.prisma.tutor_profile.findFirst({
        where: {
          status: 'PUBLISHED',
          OR: [
            { user: { name: { contains: cleanedRef, mode: 'insensitive' } } },
            { headline: { contains: cleanedRef, mode: 'insensitive' } },
          ],
        },
        orderBy: { rating_avg: 'desc' },
        select: { id: true },
      });
      if (global) return this.fetchTutorDetail(global.id, reviewLimit);
    }

    return null;
  }

  private async fetchTutorDetail(
    id: string,
    reviewLimit: number,
  ): Promise<TutorDetailPayload | null> {
    const tutorRow = await this.prisma.tutor_profile.findUnique({
      where: { id },
      select: {
        id: true,
        avatar_url: true,
        headline: true,
        hourly_rate_vnd: true,
        modality: true,
        rating_avg: true,
        rating_count: true,
        sessions_completed: true,
        verification_status: true,
        trial_session_enabled: true,
        instant_book_enabled: true,
        avg_response_minutes: true,
        user: { select: { name: true } },
      },
    });
    if (!tutorRow) return null;

    const reviews = await this.prisma.tutor_review.findMany({
      where: { tutor_id: id, hidden_at: null },
      orderBy: [{ helpful_count: 'desc' }, { created_at: 'desc' }],
      take: reviewLimit,
      select: {
        id: true,
        rating: true,
        comment: true,
        tags: true,
        helpful_count: true,
        created_at: true,
        user_tutor_review_reviewer_idTouser: { select: { name: true } },
      },
    });

    return {
      id: tutorRow.id,
      name: tutorRow.user.name,
      avatarUrl: tutorRow.avatar_url,
      headline: tutorRow.headline,
      hourlyRateVnd: tutorRow.hourly_rate_vnd,
      modality: tutorRow.modality,
      ratingAvg: tutorRow.rating_avg ? Number(tutorRow.rating_avg) : null,
      ratingCount: tutorRow.rating_count,
      sessionsCompleted: tutorRow.sessions_completed,
      verificationStatus: tutorRow.verification_status,
      trialSessionEnabled: tutorRow.trial_session_enabled,
      instantBookEnabled: tutorRow.instant_book_enabled,
      avgResponseMinutes: tutorRow.avg_response_minutes,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        tags: r.tags ?? [],
        helpfulCount: r.helpful_count,
        createdAt: r.created_at,
        reviewerName: r.user_tutor_review_reviewer_idTouser.name,
      })),
    };
  }
}
