import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { onTutoringMineChanged } from '@cogniva/server-core/cache/invalidate';
import { z } from 'zod';

import { PrismaService } from '../../../infra/database/prisma.service';
import { validateSubject, type SubjectLevel } from '../../../common/subject-taxonomy';

const CREATE_SCHEMA = z.object({
  title: z.string().min(10).max(160),
  description: z.string().min(50).max(2000),
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  budgetVnd: z.number().int().min(10000).max(10000000).nullable().optional(),
  modality: z.enum(['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID']),
  urgency: z.enum(['ASAP', 'THIS_WEEK', 'THIS_MONTH', 'FLEXIBLE']),
});

const PATCH_SCHEMA = z.object({
  title: z.string().min(10).max(160).optional(),
  description: z.string().min(50).max(2000).optional(),
  budgetVnd: z.number().int().min(10000).max(10000000).nullable().optional(),
  status: z.enum(['OPEN', 'MATCHED', 'CLOSED']).optional(),
});

const APPLY_SCHEMA = z.object({
  message: z.string().min(20).max(1000),
  proposedRateVnd: z.number().int().min(10000).max(10000000),
});

const APP_PATCH_SCHEMA = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
});
export type ApplicationPatchInput = z.infer<typeof APP_PATCH_SCHEMA>;
export { APP_PATCH_SCHEMA };

type RequestRow = {
  id: string;
  student_id: string;
  title: string;
  description: string;
  subject_slug: string;
  level: string;
  budget_vnd: number | null;
  modality: string;
  urgency: string;
  status: string;
  embedding_updated_at: Date | null;
  created_at: Date;
  expires_at: Date | null;
};

@Injectable()
export class TutoringRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, raw: unknown) {
    const parsed = CREATE_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    const subject = validateSubject(parsed.data.subjectSlug, parsed.data.level as SubjectLevel);
    if (!subject) {
      throw new BadRequestException({ error: 'Môn / level không hợp lệ' });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const created = await this.prisma.tutor_request.create({
      data: {
        id: randomUUID(),
        student_id: userId,
        title: parsed.data.title.trim(),
        description: parsed.data.description.trim(),
        subject_slug: parsed.data.subjectSlug,
        level: parsed.data.level,
        budget_vnd: parsed.data.budgetVnd ?? null,
        modality: parsed.data.modality,
        urgency: parsed.data.urgency,
        expires_at: expiresAt,
      },
    });

    await onTutoringMineChanged(userId);

    return { request: this.serializeRequest(created, null) };
  }

  async detail(id: string, userId: string | null) {
    const row = await this.prisma.tutor_request.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        subject_slug: true,
        level: true,
        budget_vnd: true,
        modality: true,
        urgency: true,
        status: true,
        created_at: true,
        expires_at: true,
        student_id: true,
        user: { select: { name: true, image: true } },
      },
    });
    if (!row) throw new NotFoundException({ error: 'Not found' });

    const req = {
      id: row.id,
      title: row.title,
      description: row.description,
      subjectSlug: row.subject_slug,
      level: row.level,
      budgetVnd: row.budget_vnd,
      modality: row.modality,
      urgency: row.urgency,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      studentId: row.student_id,
      studentName: row.user.name,
      studentImage: row.user.image,
    };

    const isOwner = userId === req.studentId;

    let myApplication: { id: string; status: string } | null = null;
    let isTutor = false;
    if (userId && !isOwner) {
      const myProfile = await this.prisma.tutor_profile.findUnique({
        where: { user_id: userId },
        select: { id: true },
      });
      isTutor = !!myProfile;
      if (myProfile) {
        const app = await this.prisma.tutor_application.findFirst({
          where: { request_id: id },
          select: { id: true, status: true },
        });
        const mine = app
          ? await this.prisma.tutor_application.findFirst({
              where: { tutor_id: myProfile.id },
              select: { id: true, status: true },
            })
          : null;
        if (mine) myApplication = mine;
      }
    }

    if (isOwner) {
      const rows = await this.prisma.tutor_application.findMany({
        where: { request_id: id },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          tutor_id: true,
          message: true,
          proposed_rate_vnd: true,
          status: true,
          created_at: true,
          tutor_profile: {
            select: {
              headline: true,
              rating_avg: true,
              rating_count: true,
              sessions_completed: true,
              avatar_url: true,
              user_id: true,
            },
          },
        },
      });

      const applications = rows.map((a) => ({
        id: a.id,
        tutorId: a.tutor_id,
        message: a.message,
        proposedRateVnd: a.proposed_rate_vnd,
        status: a.status,
        createdAt: a.created_at,
        tutorHeadline: a.tutor_profile.headline,
        tutorRating:
          a.tutor_profile.rating_avg === null ? null : a.tutor_profile.rating_avg.toFixed(2),
        tutorRatingCount: a.tutor_profile.rating_count,
        tutorSessionsCompleted: a.tutor_profile.sessions_completed,
        tutorAvatarUrl: a.tutor_profile.avatar_url,
        tutorUserId: a.tutor_profile.user_id,
      }));

      return { request: req, isOwner: true, applications };
    }

    return { request: req, isOwner: false, isTutor, myApplication };
  }

  async update(userId: string, id: string, raw: unknown) {
    const existing = await this.prisma.tutor_request.findUnique({
      where: { id },
      select: { student_id: true },
    });
    if (!existing) throw new NotFoundException({ error: 'Not found' });
    if (existing.student_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    const parsed = PATCH_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    const data: Prisma.tutor_requestUpdateInput = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.budgetVnd !== undefined) data.budget_vnd = parsed.data.budgetVnd;
    if (parsed.data.status !== undefined) data.status = parsed.data.status;

    const updated = await this.prisma.tutor_request.update({ where: { id }, data });

    const [emb] = await this.prisma.$queryRaw<{ embedding: string | null }[]>(
      Prisma.sql`SELECT embedding::text AS embedding FROM tutor_request WHERE id = ${id}`,
    );
    const embedding = emb?.embedding ? (JSON.parse(emb.embedding) as number[]) : null;

    await onTutoringMineChanged(existing.student_id);

    return { request: this.serializeRequest(updated, embedding) };
  }

  async apply(userId: string, id: string, raw: unknown) {
    const myProfile = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true, status: true },
    });
    if (!myProfile) {
      throw new ForbiddenException({ error: 'Cần tạo tutor profile trước khi apply' });
    }

    const req = await this.prisma.tutor_request.findUnique({
      where: { id },
      select: { student_id: true, status: true },
    });
    if (!req) throw new NotFoundException({ error: 'Not found' });
    if (req.status !== 'OPEN') {
      throw new BadRequestException({ error: 'Request đã đóng, không thể apply' });
    }
    if (req.student_id === userId) {
      throw new BadRequestException({ error: 'Không thể apply vào request của chính mình' });
    }

    const parsed = APPLY_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    try {
      const created = await this.prisma.tutor_application.create({
        data: {
          id: randomUUID(),
          request_id: id,
          tutor_id: myProfile.id,
          message: parsed.data.message.trim(),
          proposed_rate_vnd: parsed.data.proposedRateVnd,
        },
      });

      await onTutoringMineChanged(userId);

      return {
        application: {
          id: created.id,
          requestId: created.request_id,
          tutorId: created.tutor_id,
          message: created.message,
          proposedRateVnd: created.proposed_rate_vnd,
          status: created.status,
          createdAt: created.created_at,
        },
      };
    } catch (err) {
      throw new HttpException(
        { error: 'Bạn đã apply request này rồi', details: (err as Error).message },
        409,
      );
    }
  }

  async patchApplication(userId: string, id: string, body: ApplicationPatchInput) {
    const app = await this.prisma.tutor_application.findUnique({
      where: { id },
      select: {
        id: true,
        request_id: true,
        status: true,
        tutor_profile: { select: { user_id: true } },
      },
    });
    if (!app) throw new NotFoundException({ error: 'Not found' });

    const req = await this.prisma.tutor_request.findUnique({
      where: { id: app.request_id },
      select: { student_id: true, status: true },
    });
    if (!req) throw new NotFoundException({ error: 'Request gone' });
    if (req.student_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }
    if (app.status !== 'PENDING') {
      throw new BadRequestException({ error: 'Application đã xử lý rồi' });
    }

    if (body.status === 'ACCEPTED') {
      const cascadeRejected = await this.prisma.tutor_application.findMany({
        where: {
          request_id: app.request_id,
          status: 'PENDING',
          id: { not: id },
        },
        select: { tutor_profile: { select: { user_id: true } } },
      });

      await this.prisma.$transaction([
        this.prisma.tutor_application.update({
          where: { id },
          data: { status: 'ACCEPTED' },
        }),
        this.prisma.tutor_application.updateMany({
          where: {
            request_id: app.request_id,
            status: 'PENDING',
            id: { not: id },
          },
          data: { status: 'REJECTED' },
        }),
        this.prisma.tutor_request.update({
          where: { id: app.request_id },
          data: { status: 'MATCHED' },
        }),
      ]);

      const affected = new Set<string>([userId, app.tutor_profile.user_id]);
      for (const r of cascadeRejected) affected.add(r.tutor_profile.user_id);
      await Promise.all([...affected].map((uid) => onTutoringMineChanged(uid)));

      return { ok: true, status: 'ACCEPTED' };
    }

    await this.prisma.tutor_application.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    await onTutoringMineChanged(app.tutor_profile.user_id);

    return { ok: true, status: 'REJECTED' };
  }

  private serializeRequest(row: RequestRow, embedding: number[] | null) {
    return {
      id: row.id,
      studentId: row.student_id,
      title: row.title,
      description: row.description,
      subjectSlug: row.subject_slug,
      level: row.level,
      budgetVnd: row.budget_vnd,
      modality: row.modality,
      urgency: row.urgency,
      status: row.status,
      embedding,
      embeddingUpdatedAt: row.embedding_updated_at,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }
}
