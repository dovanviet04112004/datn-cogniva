import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type library_course, type library_university } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../../../infra/database/prisma.service';

const UNIVERSITY_BODY = z.object({
  name: z.string().min(2).max(160),
  shortName: z.string().max(40).optional(),
});

const COURSE_BODY = z.object({
  name: z.string().min(2).max(160),
  code: z.string().max(40).optional(),
  universityId: z.string().optional(),
});

@Injectable()
export class LibraryCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listUniversities(q: string, limit: number) {
    const where =
      q.length > 0
        ? Prisma.sql`WHERE (name ILIKE ${`%${q}%`} OR short_name ILIKE ${`%${q}%`})`
        : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        slug: string;
        name: string;
        short_name: string | null;
        doc_count: number;
      }>
    >(Prisma.sql`
      SELECT id, slug, name, short_name, doc_count
      FROM library_university
      ${where}
      ORDER BY doc_count DESC
      LIMIT ${limit}`);
    return {
      universities: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        shortName: r.short_name,
        docCount: r.doc_count,
      })),
    };
  }

  async createUniversity(raw: unknown) {
    const parsed = UNIVERSITY_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const slug = slugifyVi(parsed.data.name);
    if (!slug) throw new BadRequestException({ error: 'Tên không hợp lệ' });

    const existing = await this.prisma.library_university.findUnique({ where: { slug } });
    if (existing) {
      return { university: toUniversityDto(existing), created: false };
    }

    const created = await this.prisma.library_university.create({
      data: {
        id: randomUUID(),
        slug,
        name: parsed.data.name.trim(),
        short_name: parsed.data.shortName?.trim() || null,
      },
    });
    return { university: toUniversityDto(created), created: true };
  }

  async listCourses(q: string, universityId: string | null, limit: number) {
    const conds: Prisma.Sql[] = [];
    if (q.length > 0) {
      conds.push(Prisma.sql`(c.name ILIKE ${`%${q}%`} OR c.code ILIKE ${`%${q}%`})`);
    }
    if (universityId) {
      conds.push(Prisma.sql`(c.university_id = ${universityId} OR c.university_id IS NULL)`);
    }
    const where =
      conds.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        code: string | null;
        university_id: string | null;
        university_name: string | null;
        university_short: string | null;
        doc_count: number;
      }>
    >(Prisma.sql`
      SELECT c.id, c.name, c.code, c.university_id,
        u.name AS university_name, u.short_name AS university_short, c.doc_count
      FROM library_course c
      LEFT JOIN library_university u ON u.id = c.university_id
      ${where}
      ORDER BY c.doc_count DESC
      LIMIT ${limit}`);
    return {
      courses: rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        universityId: r.university_id,
        universityName: r.university_name,
        universityShort: r.university_short,
        docCount: r.doc_count,
      })),
    };
  }

  async createCourse(userId: string, raw: unknown) {
    const parsed = COURSE_BODY.safeParse(raw);
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
      if (!u) throw new BadRequestException({ error: 'University không tồn tại' });
    }

    const existing = await this.prisma.library_course.findFirst({
      where: { university_id: universityId, slug },
    });
    if (existing) {
      return { course: toCourseDto(existing), created: false };
    }

    const created = await this.prisma.library_course.create({
      data: {
        id: randomUUID(),
        university_id: universityId,
        code: parsed.data.code?.trim() || null,
        name: parsed.data.name.trim(),
        slug,
        created_by: userId,
      },
    });
    return { course: toCourseDto(created), created: true };
  }
}

function toUniversityDto(row: library_university) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.short_name,
    country: row.country,
    logoUrl: row.logo_url,
    docCount: row.doc_count,
    createdAt: row.created_at,
  };
}

function toCourseDto(row: library_course) {
  return {
    id: row.id,
    universityId: row.university_id,
    code: row.code,
    name: row.name,
    slug: row.slug,
    subjectArea: row.subject_area,
    docCount: row.doc_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function slugifyVi(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
