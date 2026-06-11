import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

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

@Injectable()
export class TutorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

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
