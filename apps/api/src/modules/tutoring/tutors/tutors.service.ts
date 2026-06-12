import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';

import { EmbeddingService } from '../../../infra/ai/embedding.service';
import { PrismaService } from '../../../infra/database/prisma.service';
import { validateSubject, type SubjectLevel } from '../../../common/subject-taxonomy';

const CREATE_SCHEMA = z.object({
  headline: z.string().min(10).max(160),
  bio: z.string().min(200).max(2000),
  hourlyRateVnd: z.number().int().min(10000).max(10000000),
  modality: z.enum(['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID']),
});

const SLOT_SCHEMA = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().default('Asia/Ho_Chi_Minh'),
});

const AVAILABILITY_SCHEMA = z.object({
  slots: z.array(SLOT_SCHEMA).max(50),
});

const SUBJECT_SCHEMA = z.object({
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
});

interface TutorProfileRow {
  id: string;
  user_id: string;
  headline: string;
  bio: string;
  hourly_rate_vnd: number;
  modality: string;
  avatar_url: string | null;
  banner_url: string | null;
  sessions_completed: number;
  rating_avg: string | null;
  rating_count: number;
  verification_status: string;
  bio_embedding: string | null;
  bio_embedding_updated_at: Date | null;
  instant_book_enabled: boolean;
  trial_session_enabled: boolean;
  avg_response_minutes: number | null;
  response_rate_pct: number | null;
  ical_token: string | null;
  intro_video_url: string | null;
  intro_video_thumb_url: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface SubjectRow {
  id: string;
  tutor_id: string;
  subject_slug: string;
  level: string;
  verified_at: Date | null;
  verify_score: number | null;
}

export interface TutorsBrowseQuery {
  subject?: string;
  level?: string;
  modality?: string;
  minRate?: string;
  maxRate?: string;
  sort?: string;
  page?: string;
  per?: string;
}

interface BrowseRow {
  id: string;
  headline: string;
  hourly_rate_vnd: number;
  modality: string;
  avatar_url: string | null;
  rating_avg: string | null;
  rating_count: number;
  sessions_completed: number;
  verification_status: string;
  instant_book_enabled: boolean;
  trial_session_enabled: boolean;
  avg_response_minutes: number | null;
  user_id: string;
  user_name: string | null;
  user_image: string | null;
  subjects: Array<{ slug: string; level: string; verifiedAt: string | null }>;
}

const ALLOWED_PAGE_SIZES = [12, 24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;

function parsePageSize(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

@Injectable()
export class TutorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async browse(query: TutorsBrowseQuery) {
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const pageSize = parsePageSize(query.per);
    const offset = (page - 1) * pageSize;
    const sort = query.sort ?? 'top';

    const conds: Prisma.Sql[] = [Prisma.sql`tp.status = 'PUBLISHED'`];
    if (query.modality) conds.push(Prisma.sql`tp.modality = ${query.modality}`);
    if (query.minRate) {
      const v = parseInt(query.minRate, 10);
      if (!isNaN(v)) conds.push(Prisma.sql`tp.hourly_rate_vnd >= ${v}`);
    }
    if (query.maxRate) {
      const v = parseInt(query.maxRate, 10);
      if (!isNaN(v)) conds.push(Prisma.sql`tp.hourly_rate_vnd <= ${v}`);
    }
    if (query.subject) {
      conds.push(Prisma.sql`EXISTS (
        SELECT 1 FROM tutor_subject ts
        WHERE ts.tutor_id = tp.id
          AND ts.subject_slug = ${query.subject}
          ${query.level ? Prisma.sql`AND ts.level = ${query.level}` : Prisma.empty}
      )`);
    }
    const where = Prisma.join(conds, ' AND ');

    const orderBy = (() => {
      switch (sort) {
        case 'rating':
          return Prisma.sql`COALESCE(tp.rating_avg, 0) DESC, tp.rating_count DESC`;
        case 'price-low':
          return Prisma.sql`tp.hourly_rate_vnd ASC`;
        case 'price-high':
          return Prisma.sql`tp.hourly_rate_vnd DESC`;
        case 'newest':
          return Prisma.sql`tp.created_at DESC`;
        case 'sessions':
          return Prisma.sql`tp.sessions_completed DESC`;
        case 'top':
        default:
          return Prisma.sql`(COALESCE(tp.rating_avg, 0) * 100
            + LEAST(tp.sessions_completed, 200)
            + CASE WHEN tp.verification_status = 'KYC_VERIFIED' THEN 50 ELSE 0 END
            + CASE WHEN tp.instant_book_enabled THEN 30 ELSE 0 END) DESC`;
      }
    })();

    const filterHash = [
      `s=${query.subject ?? 'all'}`,
      `l=${query.level ?? 'all'}`,
      `m=${query.modality ?? 'all'}`,
      `min=${query.minRate ?? ''}`,
      `max=${query.maxRate ?? ''}`,
      `sort=${sort}`,
      `p=${page}`,
      `per=${pageSize}`,
    ].join('|');

    const data = await cached(ck.tutorsBrowse(filterHash), 600, async () => {
      const [countRows, rows] = await Promise.all([
        this.prisma.$queryRaw<Array<{ n: number }>>(
          Prisma.sql`SELECT count(*)::int AS n FROM tutor_profile tp WHERE ${where}`,
        ),
        this.prisma.$queryRaw<BrowseRow[]>(Prisma.sql`
          SELECT tp.id, tp.headline, tp.hourly_rate_vnd, tp.modality, tp.avatar_url,
                 tp.rating_avg::text AS rating_avg, tp.rating_count, tp.sessions_completed,
                 tp.verification_status, tp.instant_book_enabled, tp.trial_session_enabled,
                 tp.avg_response_minutes, tp.user_id,
                 u.name AS user_name, u.image AS user_image,
                 COALESCE(
                   (SELECT json_agg(json_build_object(
                     'slug', ts.subject_slug,
                     'level', ts.level,
                     'verifiedAt', ts.verified_at
                   ))
                   FROM tutor_subject ts
                   WHERE ts.tutor_id = tp.id),
                   '[]'::json
                 ) AS subjects
          FROM tutor_profile tp
          INNER JOIN "user" u ON u.id = tp.user_id
          WHERE ${where}
          ORDER BY ${orderBy}
          LIMIT ${pageSize} OFFSET ${offset}`),
      ]);
      return { totalCount: countRows[0]?.n ?? 0, rows };
    });

    return {
      totalCount: data.totalCount,
      tutors: data.rows.map((r) => ({
        id: r.id,
        headline: r.headline,
        hourlyRateVnd: r.hourly_rate_vnd,
        modality: r.modality,
        avatarUrl: r.avatar_url,
        ratingAvg: r.rating_avg,
        ratingCount: r.rating_count,
        sessionsCompleted: r.sessions_completed,
        verificationStatus: r.verification_status,
        instantBookEnabled: r.instant_book_enabled,
        trialSessionEnabled: r.trial_session_enabled,
        avgResponseMinutes: r.avg_response_minutes,
        userId: r.user_id,
        userName: r.user_name,
        userImage: r.user_image,
        subjects: r.subjects,
      })),
    };
  }

  async getDetail(viewerId: string, id: string) {
    const profileRow = await this.prisma.tutor_profile.findUnique({
      where: { id },
      include: { user: { select: { name: true, image: true } } },
    });
    if (!profileRow) throw new NotFoundException({ error: 'Not found' });

    const isOwner = profileRow.user_id === viewerId;
    if (profileRow.status !== 'PUBLISHED' && !isOwner) {
      throw new NotFoundException({ error: 'Not found' });
    }

    const [subjects, availability, reviews, packs, favorite, trialBooking] = await Promise.all([
      this.prisma.tutor_subject.findMany({ where: { tutor_id: id } }),
      this.prisma.tutor_availability.findMany({
        where: { tutor_id: id },
        orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }],
      }),
      this.prisma.tutor_review.findMany({
        where: { tutor_id: id, hidden_at: null },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: {
          id: true,
          rating: true,
          comment: true,
          created_at: true,
          user_tutor_review_reviewer_idTouser: { select: { name: true, image: true } },
        },
      }),
      this.prisma.tutoring_pack.findMany({ where: { tutor_id: id, status: 'ACTIVE' } }),
      this.prisma.tutor_favorite.findUnique({
        where: { user_id_tutor_id: { user_id: viewerId, tutor_id: id } },
        select: { tutor_id: true },
      }),
      this.prisma.tutoring_booking.findFirst({
        where: { student_id: viewerId, tutor_id: id, is_trial: true },
        select: { id: true },
      }),
    ]);

    return {
      profile: {
        id: profileRow.id,
        userId: profileRow.user_id,
        headline: profileRow.headline,
        bio: profileRow.bio,
        hourlyRateVnd: profileRow.hourly_rate_vnd,
        modality: profileRow.modality,
        avatarUrl: profileRow.avatar_url,
        bannerUrl: profileRow.banner_url,
        sessionsCompleted: profileRow.sessions_completed,
        ratingAvg: profileRow.rating_avg === null ? null : profileRow.rating_avg.toFixed(2),
        ratingCount: profileRow.rating_count,
        verificationStatus: profileRow.verification_status,
        status: profileRow.status,
        instantBookEnabled: profileRow.instant_book_enabled,
        trialSessionEnabled: profileRow.trial_session_enabled,
        avgResponseMinutes: profileRow.avg_response_minutes,
        responseRatePct: profileRow.response_rate_pct,
        introVideoUrl: profileRow.intro_video_url,
        introVideoThumbUrl: profileRow.intro_video_thumb_url,
        userName: profileRow.user.name,
        userImage: profileRow.user.image,
      },
      subjects: subjects.map((s) => this.toSubjectDto(s)),
      availability: availability.map((a) => ({
        id: a.id,
        tutorId: a.tutor_id,
        dayOfWeek: a.day_of_week,
        startTime: a.start_time,
        endTime: a.end_time,
        timezone: a.timezone,
      })),
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.created_at,
        reviewerName: r.user_tutor_review_reviewer_idTouser.name,
        reviewerImage: r.user_tutor_review_reviewer_idTouser.image,
      })),
      packs: packs.map((p) => ({
        id: p.id,
        tutorId: p.tutor_id,
        subjectSlug: p.subject_slug,
        level: p.level,
        sessionCount: p.session_count,
        durationMin: p.duration_min,
        ratePerSessionVnd: p.rate_per_session_vnd,
        totalVnd: p.total_vnd,
        discountPct: p.discount_pct,
        status: p.status,
        description: p.description,
      })),
      isFavorited: favorite !== null,
      hasTrialUsed: trialBooking !== null,
      isOwner,
    };
  }

  async createProfile(
    userId: string,
    rawBody: unknown,
  ): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
    const existing = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (existing) {
      const tutor = await this.fetchProfileDto(existing.id);
      return { httpStatus: 200, body: { tutor, reused: true } };
    }

    const parsed = CREATE_SCHEMA.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    const id = randomUUID();
    await this.prisma.tutor_profile.create({
      data: {
        id,
        user_id: userId,
        headline: parsed.data.headline.trim(),
        bio: parsed.data.bio.trim(),
        hourly_rate_vnd: parsed.data.hourlyRateVnd,
        modality: parsed.data.modality,
      },
    });
    const tutor = await this.fetchProfileDto(id);
    return { httpStatus: 201, body: { tutor } };
  }

  async replaceAvailability(userId: string, id: string, rawBody: unknown) {
    await this.ensureOwnerProfile(id, userId);

    const parsed = AVAILABILITY_SCHEMA.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    for (const slot of parsed.data.slots) {
      if (slot.startTime >= slot.endTime) {
        throw new BadRequestException({
          error: `Slot ${slot.dayOfWeek}: start phải nhỏ hơn end`,
        });
      }
    }

    await this.prisma.$transaction([
      this.prisma.tutor_availability.deleteMany({ where: { tutor_id: id } }),
      ...(parsed.data.slots.length > 0
        ? [
            this.prisma.tutor_availability.createMany({
              data: parsed.data.slots.map((s) => ({
                id: randomUUID(),
                tutor_id: id,
                day_of_week: s.dayOfWeek,
                start_time: s.startTime,
                end_time: s.endTime,
                timezone: s.timezone,
              })),
            }),
          ]
        : []),
    ]);

    return { ok: true, count: parsed.data.slots.length };
  }

  async toggleFavorite(userId: string, tutorId: string) {
    const tutor = await this.prisma.tutor_profile.findUnique({
      where: { id: tutorId },
      select: { id: true },
    });
    if (!tutor) throw new NotFoundException({ error: 'Tutor not found' });

    const existing = await this.prisma.tutor_favorite.findUnique({
      where: { user_id_tutor_id: { user_id: userId, tutor_id: tutorId } },
      select: { tutor_id: true },
    });

    if (existing) {
      await this.prisma.tutor_favorite.deleteMany({
        where: { user_id: userId, tutor_id: tutorId },
      });
      return { favorited: false };
    }
    await this.prisma.tutor_favorite.create({
      data: { user_id: userId, tutor_id: tutorId },
    });
    return { favorited: true };
  }

  async publish(userId: string, id: string) {
    const existing = await this.prisma.tutor_profile.findUnique({
      where: { id },
      select: { user_id: true, status: true, bio: true, headline: true },
    });
    if (!existing) throw new NotFoundException({ error: 'Not found' });
    if (existing.user_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    const subjCount = await this.prisma.tutor_subject.count({ where: { tutor_id: id } });
    if (subjCount === 0) {
      throw new BadRequestException({ error: 'Cần ít nhất 1 môn dạy trước khi publish' });
    }

    const availCount = await this.prisma.tutor_availability.count({
      where: { tutor_id: id },
    });
    if (availCount === 0) {
      throw new BadRequestException({
        error: 'Cần ít nhất 1 khung giờ rảnh trước khi publish',
      });
    }

    let bioEmbedding: number[] | null = null;
    try {
      const text = `${existing.headline}\n${existing.bio}`.slice(0, 8000);
      bioEmbedding = await this.embedding.embedQuery(text);
    } catch (err) {
      console.error('[tutor.publish.embed]', err);
    }

    const now = new Date();
    if (bioEmbedding) {
      await this.prisma.$executeRaw`
        UPDATE tutor_profile
        SET status = 'PUBLISHED', updated_at = ${now},
            bio_embedding = ${`[${bioEmbedding.join(',')}]`}::vector,
            bio_embedding_updated_at = ${now}
        WHERE id = ${id}`;
    } else {
      await this.prisma.tutor_profile.update({
        where: { id },
        data: { status: 'PUBLISHED', updated_at: now },
      });
    }

    const tutor = await this.fetchProfileDto(id);
    return { tutor };
  }

  async addSubject(userId: string, id: string, rawBody: unknown) {
    await this.ensureOwnerProfile(id, userId);

    const parsed = SUBJECT_SCHEMA.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    const subject = validateSubject(parsed.data.subjectSlug, parsed.data.level as SubjectLevel);
    if (!subject) {
      throw new BadRequestException({ error: 'Môn / level không hợp lệ' });
    }

    try {
      const inserted = await this.prisma.tutor_subject.create({
        data: {
          id: randomUUID(),
          tutor_id: id,
          subject_slug: parsed.data.subjectSlug,
          level: parsed.data.level,
        },
      });
      return { subject: this.toSubjectDto(inserted) };
    } catch (err) {
      throw new ConflictException({
        error: 'Môn này đã được thêm',
        details: (err as Error).message,
      });
    }
  }

  private async ensureOwnerProfile(id: string, userId: string) {
    const profile = await this.prisma.tutor_profile.findUnique({
      where: { id },
      select: { user_id: true },
    });
    if (!profile) throw new NotFoundException({ error: 'Not found' });
    if (profile.user_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }
  }

  private async fetchProfileDto(id: string) {
    const rows = await this.prisma.$queryRaw<TutorProfileRow[]>`
      SELECT id, user_id, headline, bio, hourly_rate_vnd, modality, avatar_url,
             banner_url, sessions_completed, rating_avg::text AS rating_avg,
             rating_count, verification_status,
             bio_embedding::text AS bio_embedding, bio_embedding_updated_at,
             instant_book_enabled, trial_session_enabled, avg_response_minutes,
             response_rate_pct, ical_token, intro_video_url,
             intro_video_thumb_url, status, created_at, updated_at
      FROM tutor_profile WHERE id = ${id} LIMIT 1`;
    const row = rows[0];
    return row ? this.toTutorDto(row) : null;
  }

  private toTutorDto(row: TutorProfileRow) {
    return {
      id: row.id,
      userId: row.user_id,
      headline: row.headline,
      bio: row.bio,
      hourlyRateVnd: row.hourly_rate_vnd,
      modality: row.modality,
      avatarUrl: row.avatar_url,
      bannerUrl: row.banner_url,
      sessionsCompleted: row.sessions_completed,
      ratingAvg: row.rating_avg,
      ratingCount: row.rating_count,
      verificationStatus: row.verification_status,
      bioEmbedding: row.bio_embedding ? (JSON.parse(row.bio_embedding) as number[]) : null,
      bioEmbeddingUpdatedAt: row.bio_embedding_updated_at,
      instantBookEnabled: row.instant_book_enabled,
      trialSessionEnabled: row.trial_session_enabled,
      avgResponseMinutes: row.avg_response_minutes,
      responseRatePct: row.response_rate_pct,
      icalToken: row.ical_token,
      introVideoUrl: row.intro_video_url,
      introVideoThumbUrl: row.intro_video_thumb_url,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSubjectDto(row: SubjectRow) {
    return {
      id: row.id,
      tutorId: row.tutor_id,
      subjectSlug: row.subject_slug,
      level: row.level,
      verifiedAt: row.verified_at,
      verifyScore: row.verify_score,
    };
  }
}
