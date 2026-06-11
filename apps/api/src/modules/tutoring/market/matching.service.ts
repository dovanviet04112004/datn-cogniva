import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { EmbeddingService } from '../../../infra/ai/embedding.service';
import { PrismaService } from '../../../infra/database/prisma.service';
import { SUBJECT_BY_SLUG } from '../../../common/subject-taxonomy';
import type { CompareInput } from './dto/market.dto';

const EMBED_DIM = 1024;

type RequestRow = {
  id: string;
  title: string;
  description: string;
  subject_slug: string;
  level: string;
  embedding: string | null;
};

type CandidateRow = {
  id: string;
  bio: string;
  headline: string;
  bio_embedding: string | null;
};

type RankedRow = {
  id: string;
  headline: string;
  hourly_rate_vnd: number;
  modality: string;
  avatar_url: string | null;
  rating_avg: string | null;
  rating_count: number;
  sessions_completed: number;
  verification_status: string;
  user_name: string | null;
  score: number;
};

function parseVector(text: string | null): number[] | null {
  if (!text) return null;
  return JSON.parse(text) as number[];
}

@Injectable()
export class TutoringMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async matches(requestId: string) {
    const [req] = await this.prisma.$queryRaw<RequestRow[]>(Prisma.sql`
      SELECT id, title, description, subject_slug, level, embedding::text AS embedding
      FROM tutor_request WHERE id = ${requestId} LIMIT 1
    `);
    if (!req) throw new NotFoundException({ error: 'Request not found' });

    const existing = parseVector(req.embedding);
    let reqEmbedding: number[];
    if (existing && existing.length === EMBED_DIM) {
      reqEmbedding = existing;
    } else {
      const subjectName = SUBJECT_BY_SLUG[req.subject_slug]?.name ?? req.subject_slug;
      reqEmbedding = await this.embedding.embedQuery(
        `${subjectName} ${req.level}\n${req.title}\n${req.description}`,
      );
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE tutor_request
        SET embedding = ${`[${reqEmbedding.join(',')}]`}::vector
        WHERE id = ${requestId}
      `);
    }

    const candidates = await this.prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT tp.id, tp.bio, tp.headline, tp.bio_embedding::text AS bio_embedding
      FROM tutor_profile tp
      INNER JOIN tutor_subject ts ON ts.tutor_id = tp.id
      WHERE tp.status = 'PUBLISHED'
        AND ts.subject_slug = ${req.subject_slug}
        AND ts.level = ${req.level}
      LIMIT 50
    `);

    for (const c of candidates) {
      const bioEmb = parseVector(c.bio_embedding);
      if (!bioEmb || bioEmb.length !== EMBED_DIM) {
        const emb = await this.embedding.embedQuery(`${c.headline}\n${c.bio}`);
        await this.prisma.$executeRaw(Prisma.sql`
          UPDATE tutor_profile
          SET bio_embedding = ${`[${emb.join(',')}]`}::vector
          WHERE id = ${c.id}
        `);
      }
    }

    if (candidates.length === 0) {
      return { matches: [] };
    }

    const embStr = `[${reqEmbedding.join(',')}]`;
    const ranked = await this.prisma.$queryRaw<RankedRow[]>(Prisma.sql`
      SELECT
        tp.id, tp.headline, tp.hourly_rate_vnd, tp.modality, tp.avatar_url,
        tp.rating_avg::text AS rating_avg, tp.rating_count, tp.sessions_completed,
        tp.verification_status, u.name AS user_name,
        1 - (tp.bio_embedding <=> ${embStr}::vector) AS score
      FROM tutor_profile tp
      INNER JOIN "user" u ON u.id = tp.user_id
      INNER JOIN tutor_subject ts ON ts.tutor_id = tp.id
      WHERE tp.status = 'PUBLISHED'
        AND ts.subject_slug = ${req.subject_slug}
        AND ts.level = ${req.level}
        AND tp.bio_embedding IS NOT NULL
      ORDER BY tp.bio_embedding <=> ${embStr}::vector
      LIMIT 5
    `);

    const matches = ranked.filter((m) => Number(m.score) > 0.3);

    return {
      matches: matches.map((m) => ({
        tutorId: m.id,
        headline: m.headline,
        hourlyRateVnd: m.hourly_rate_vnd,
        modality: m.modality,
        avatarUrl: m.avatar_url,
        ratingAvg: m.rating_avg ? Number(m.rating_avg) : null,
        ratingCount: m.rating_count,
        sessionsCompleted: m.sessions_completed,
        verificationStatus: m.verification_status,
        name: m.user_name,
        score: Math.round(Number(m.score) * 100) / 100,
      })),
    };
  }

  async compare(body: CompareInput) {
    const ids = body.tutorIds;

    const tutors = await this.prisma.tutor_profile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        headline: true,
        hourly_rate_vnd: true,
        modality: true,
        avatar_url: true,
        rating_avg: true,
        rating_count: true,
        sessions_completed: true,
        verification_status: true,
        instant_book_enabled: true,
        avg_response_minutes: true,
        response_rate_pct: true,
        user: { select: { name: true } },
      },
    });

    if (tutors.length === 0) {
      return { tutors: [] };
    }

    const subjects = await this.prisma.tutor_subject.findMany({
      where: { tutor_id: { in: ids } },
    });

    const packs = await this.prisma.tutoring_pack.findMany({
      where: { tutor_id: { in: ids }, status: 'ACTIVE' },
    });

    const now = new Date();
    const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingBookings = await this.prisma.tutoring_booking.findMany({
      where: {
        tutor_id: { in: ids },
        status: { in: ['CONFIRMED', 'PENDING_TUTOR', 'IN_PROGRESS'] },
        start_at: { gte: now, lte: sevenDaysAhead },
      },
      select: { tutor_id: true, start_at: true, end_at: true },
    });

    const availability = await this.prisma.tutor_availability.findMany({
      where: { tutor_id: { in: ids } },
    });

    const compareRows = tutors.map((t) => {
      const subjList = subjects.filter((s) => s.tutor_id === t.id);
      const packsForTutor = packs.filter((p) => p.tutor_id === t.id);
      const bestPack = packsForTutor.sort(
        (a, b) => a.rate_per_session_vnd - b.rate_per_session_vnd,
      )[0];
      const hasSlots = availability.some((a) => a.tutor_id === t.id);

      let nextSlot: Date | null = null;
      if (hasSlots) {
        const conflicts = upcomingBookings.filter((b) => b.tutor_id === t.id);
        const tutorAvail = availability
          .filter((a) => a.tutor_id === t.id)
          .sort((a, b) =>
            a.day_of_week === b.day_of_week
              ? a.start_time.localeCompare(b.start_time)
              : a.day_of_week - b.day_of_week,
          );
        for (let i = 0; i < 7; i++) {
          const dayCheck = new Date(now);
          dayCheck.setDate(now.getDate() + i);
          const dow = dayCheck.getDay();
          const avs = tutorAvail.filter((a) => a.day_of_week === dow);
          for (const av of avs) {
            const [h, m] = av.start_time.split(':').map((p) => parseInt(p, 10));
            const slot = new Date(dayCheck);
            slot.setHours(h!, m!, 0, 0);
            if (slot.getTime() < now.getTime() + 60 * 60 * 1000) continue;
            const inConflict = conflicts.some((b) => b.start_at <= slot && b.end_at > slot);
            if (!inConflict) {
              nextSlot = slot;
              break;
            }
          }
          if (nextSlot) break;
        }
      }

      return {
        id: t.id,
        name: t.user.name,
        headline: t.headline,
        avatarUrl: t.avatar_url,
        hourlyRateVnd: t.hourly_rate_vnd,
        ratingAvg: t.rating_avg ? Number(t.rating_avg) : null,
        ratingCount: t.rating_count,
        sessionsCompleted: t.sessions_completed,
        verificationStatus: t.verification_status,
        modality: t.modality,
        instantBookEnabled: t.instant_book_enabled,
        avgResponseMinutes: t.avg_response_minutes,
        responseRatePct: t.response_rate_pct,
        subjects: subjList.map((s) => ({
          slug: s.subject_slug,
          level: s.level,
          verified: !!s.verified_at,
        })),
        bestPack: bestPack
          ? {
              sessionCount: bestPack.session_count,
              totalVnd: bestPack.total_vnd,
              ratePerSessionVnd: bestPack.rate_per_session_vnd,
              discountPct: bestPack.discount_pct,
            }
          : null,
        nextSlot: nextSlot?.toISOString() ?? null,
      };
    });

    return { tutors: compareRows };
  }
}
