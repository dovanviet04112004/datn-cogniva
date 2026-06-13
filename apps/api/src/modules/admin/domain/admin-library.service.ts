import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { onLibraryCatalogChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import { slugifyVi } from '../../library/search/catalog.service';

const universityBody = z.object({
  name: z.string().trim().min(2).max(160),
  shortName: z.string().trim().max(40).optional().nullable(),
  approved: z.boolean().optional(),
});

const courseBody = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().max(40).optional().nullable(),
  universityId: z.string().optional().nullable(),
  subjectArea: z.string().trim().max(60).optional().nullable(),
  approved: z.boolean().optional(),
});

type UniversityRow = {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  doc_count: number;
  approved: boolean;
  created_at: Date;
};

type CourseRow = {
  id: string;
  university_id: string | null;
  code: string | null;
  name: string;
  slug: string;
  subject_area: string | null;
  doc_count: number;
  approved: boolean;
  created_at: Date;
};

@Injectable()
export class AdminLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async listUniversities(q?: string) {
    const query = q?.trim() ?? '';
    const rows = await this.prisma.library_university.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { short_name: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: [{ approved: 'asc' }, { doc_count: 'desc' }, { name: 'asc' }],
      take: 300,
    });
    return { universities: rows.map(toUniversityDto) };
  }

  async createUniversity(ctx: AdminContext, raw: unknown) {
    const parsed = universityBody.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const slug = slugifyVi(parsed.data.name);
    if (!slug) throw new BadRequestException({ error: 'Tên không hợp lệ' });
    const existing = await this.prisma.library_university.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException({ error: 'Trường này đã tồn tại' });

    const id = randomUUID();
    const created = await this.prisma.library_university.create({
      data: {
        id,
        slug,
        name: parsed.data.name.trim(),
        short_name: parsed.data.shortName?.trim() || null,
        approved: parsed.data.approved ?? true,
      },
    });
    await this.audit.withAudit(
      ctx,
      'library.university.create',
      { type: 'library_university', id },
      async () => ({ after: created, result: null }),
    );
    await onLibraryCatalogChanged();
    return { university: toUniversityDto(created) };
  }

  async updateUniversity(ctx: AdminContext, id: string, raw: unknown) {
    const parsed = universityBody.partial().safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const before = await this.prisma.library_university.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: 'Không tìm thấy trường' });

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name.trim();
      data.slug = slugifyVi(parsed.data.name);
    }
    if (parsed.data.shortName !== undefined) data.short_name = parsed.data.shortName?.trim() || null;
    if (parsed.data.approved !== undefined) data.approved = parsed.data.approved;

    const updated = await this.prisma.library_university.update({ where: { id }, data });
    await this.audit.withAudit(
      ctx,
      'library.university.update',
      { type: 'library_university', id },
      async () => ({ before, after: updated, result: null }),
    );
    await onLibraryCatalogChanged();
    return { university: toUniversityDto(updated) };
  }

  async deleteUniversity(ctx: AdminContext, id: string) {
    const before = await this.prisma.library_university.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: 'Không tìm thấy trường' });
    if (before.doc_count > 0) {
      throw new BadRequestException({ error: 'Trường đang có tài liệu, không thể xoá' });
    }
    const courseCount = await this.prisma.library_course.count({ where: { university_id: id } });
    if (courseCount > 0) {
      throw new BadRequestException({ error: 'Trường còn môn học, xoá môn trước' });
    }
    await this.prisma.library_university.delete({ where: { id } });
    await this.audit.withAudit(
      ctx,
      'library.university.delete',
      { type: 'library_university', id },
      async () => ({ before, result: null }),
    );
    await onLibraryCatalogChanged();
    return { ok: true };
  }

  async listCourses(q?: string, universityId?: string) {
    const query = q?.trim() ?? '';
    const rows = await this.prisma.library_course.findMany({
      where: {
        ...(universityId ? { university_id: universityId } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { code: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ approved: 'asc' }, { doc_count: 'desc' }, { name: 'asc' }],
      take: 300,
    });
    const uniIds = [...new Set(rows.map((r) => r.university_id).filter(Boolean))] as string[];
    const unis = uniIds.length
      ? await this.prisma.library_university.findMany({
          where: { id: { in: uniIds } },
          select: { id: true, name: true, short_name: true },
        })
      : [];
    const uniMap = new Map(unis.map((u) => [u.id, u]));
    return {
      courses: rows.map((r) => {
        const uni = r.university_id ? uniMap.get(r.university_id) : null;
        return {
          ...toCourseDto(r),
          universityName: uni?.name ?? null,
          universityShort: uni?.short_name ?? null,
        };
      }),
    };
  }

  async createCourse(ctx: AdminContext, raw: unknown) {
    const parsed = courseBody.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const slug = slugifyVi(parsed.data.name);
    if (!slug) throw new BadRequestException({ error: 'Tên không hợp lệ' });
    const universityId = parsed.data.universityId || null;
    if (universityId) {
      const u = await this.prisma.library_university.findUnique({
        where: { id: universityId },
        select: { id: true },
      });
      if (!u) throw new BadRequestException({ error: 'Trường không tồn tại' });
    }
    const existing = await this.prisma.library_course.findFirst({
      where: { university_id: universityId, slug },
    });
    if (existing) throw new BadRequestException({ error: 'Môn học này đã tồn tại' });

    const id = randomUUID();
    const created = await this.prisma.library_course.create({
      data: {
        id,
        university_id: universityId,
        code: parsed.data.code?.trim() || null,
        name: parsed.data.name.trim(),
        slug,
        subject_area: parsed.data.subjectArea?.trim() || null,
        created_by: ctx.userId,
        approved: parsed.data.approved ?? true,
      },
    });
    await this.audit.withAudit(
      ctx,
      'library.course.create',
      { type: 'library_course', id },
      async () => ({ after: created, result: null }),
    );
    await onLibraryCatalogChanged();
    return { course: toCourseDto(created) };
  }

  async updateCourse(ctx: AdminContext, id: string, raw: unknown) {
    const parsed = courseBody.partial().safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const before = await this.prisma.library_course.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: 'Không tìm thấy môn học' });

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      data.name = parsed.data.name.trim();
      data.slug = slugifyVi(parsed.data.name);
    }
    if (parsed.data.code !== undefined) data.code = parsed.data.code?.trim() || null;
    if (parsed.data.subjectArea !== undefined) {
      data.subject_area = parsed.data.subjectArea?.trim() || null;
    }
    if (parsed.data.universityId !== undefined) data.university_id = parsed.data.universityId || null;
    if (parsed.data.approved !== undefined) data.approved = parsed.data.approved;

    const updated = await this.prisma.library_course.update({ where: { id }, data });
    await this.audit.withAudit(
      ctx,
      'library.course.update',
      { type: 'library_course', id },
      async () => ({ before, after: updated, result: null }),
    );
    await onLibraryCatalogChanged();
    return { course: toCourseDto(updated) };
  }

  async deleteCourse(ctx: AdminContext, id: string) {
    const before = await this.prisma.library_course.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ error: 'Không tìm thấy môn học' });
    if (before.doc_count > 0) {
      throw new BadRequestException({ error: 'Môn đang có tài liệu, không thể xoá' });
    }
    await this.prisma.library_course.delete({ where: { id } });
    await this.audit.withAudit(
      ctx,
      'library.course.delete',
      { type: 'library_course', id },
      async () => ({ before, result: null }),
    );
    await onLibraryCatalogChanged();
    return { ok: true };
  }
}

function toUniversityDto(row: UniversityRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.short_name,
    docCount: row.doc_count,
    approved: row.approved,
    createdAt: row.created_at,
  };
}

function toCourseDto(row: CourseRow) {
  return {
    id: row.id,
    universityId: row.university_id,
    code: row.code,
    name: row.name,
    slug: row.slug,
    subjectArea: row.subject_area,
    docCount: row.doc_count,
    approved: row.approved,
    createdAt: row.created_at,
  };
}
