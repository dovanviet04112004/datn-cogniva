import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { onLibraryCatalogChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../../infra/database/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';
import { LibraryIngestService } from './ingest.service';

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_FORMATS = ['pdf', 'docx', 'image'] as const;

const UPLOAD_INIT_BODY = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(3),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.enum(ALLOWED_FORMATS),
});

const FINALIZE_BODY = z.object({
  docId: z.string().min(1),
  storageKey: z.string().min(1),
  title: z.string().min(5).max(200),
  description: z.string().max(2000).optional(),
  courseId: z.string().optional(),
  subjectSlug: z.string().optional(),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  grade: z.number().int().min(1).max(12).optional(),
  docType: z
    .enum([
      'lecture_notes',
      'summary',
      'exam',
      'exercise',
      'solution',
      'reference_book',
      'thesis',
      'handout',
      'mind_map',
      'other',
    ])
    .default('other'),
  examType: z
    .enum(['midterm', 'final', 'graduation', 'university_entrance', 'gifted_student'])
    .optional(),
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
  region: z.string().default('national'),
  language: z.enum(['vi', 'en']).default('vi'),
  tags: z.array(z.string().min(1).max(40)).max(10).default([]),
  license: z.enum(['CC-BY-4.0', 'PUBLIC_DOMAIN', 'MINE_ONLY']).default('CC-BY-4.0'),
  licenseConfirmed: z.literal(true),
});

@Injectable()
export class LibraryUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: LibraryIngestService,
  ) {}

  async uploadInit(userId: string, raw: unknown) {
    const parsed = UPLOAD_INIT_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }
    const { contentType, sizeBytes, hash, format, filename } = parsed.data;

    const existing = await this.prisma.library_doc.findFirst({
      where: { file_hash: hash, status: 'PUBLISHED' },
      select: { id: true, title: true },
    });
    if (existing) {
      throw new HttpException(
        {
          error: 'duplicate',
          message: `Tài liệu này đã được upload với tên "${existing.title}"`,
          existingDocId: existing.id,
        },
        409,
      );
    }

    const ext = inferExt(format, filename);
    const docId = randomUUID();
    await this.prisma.library_doc.create({
      data: {
        id: docId,
        uploader_id: userId,
        title: filename.replace(/\.[^.]+$/, '').slice(0, 100),
        subject_slug: 'other',
        level: 'ADULT',
        file_format: format,
        file_size_bytes: sizeBytes,
        file_url: '',
        file_hash: hash,
        status: 'PROCESSING',
      },
    });
    const storageKey = `lib/${userId}/${docId}.${ext}`;

    const presignedUrl = await this.storage.getPresignedUploadUrl(storageKey, contentType, 900);

    return {
      docId,
      storageKey,
      presignedUrl,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
  }

  async finalize(userId: string, raw: unknown) {
    const parsed = FINALIZE_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }
    const { docId, storageKey, ...metadata } = parsed.data;

    const doc = await this.prisma.library_doc.findFirst({
      where: { id: docId, uploader_id: userId },
      select: { id: true },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);

    let courseId: string | null = null;
    let universityId: string | null = null;
    let courseNameCache: string | null = null;
    let universityNameCache: string | null = null;
    let subjectSlug = metadata.subjectSlug ?? 'other';
    if (metadata.courseId) {
      const course = await this.prisma.library_course.findUnique({
        where: { id: metadata.courseId },
      });
      if (course) {
        courseId = course.id;
        universityId = course.university_id;
        courseNameCache = course.code ? `${course.code} ${course.name}` : course.name;
        if (!metadata.subjectSlug && course.subject_area) subjectSlug = course.subject_area;
        if (universityId) {
          const uni = await this.prisma.library_university.findUnique({
            where: { id: universityId },
            select: { name: true, short_name: true },
          });
          if (uni) universityNameCache = `${uni.short_name ?? ''} ${uni.name}`.trim();
        }
      }
    }

    const fileUrl = this.storage.getPublicUrl(storageKey);
    await this.prisma.library_doc.update({
      where: { id: docId },
      data: {
        title: metadata.title,
        description: metadata.description ?? null,
        subject_slug: subjectSlug,
        course_id: courseId,
        university_id: universityId,
        course_name_cache: courseNameCache,
        university_name_cache: universityNameCache,
        level: metadata.level,
        grade: metadata.grade ?? null,
        doc_type: metadata.docType,
        exam_type: metadata.examType ?? null,
        school_year: metadata.schoolYear ?? null,
        region: metadata.region,
        language: metadata.language,
        tags: metadata.tags,
        license: metadata.license,
        file_url: fileUrl,
        updated_at: new Date(),
      },
    });

    if (courseId) {
      void this.prisma.library_course
        .update({ where: { id: courseId }, data: { doc_count: { increment: 1 } } })
        .catch(() => {});
    }
    if (universityId) {
      void this.prisma.library_university
        .update({ where: { id: universityId }, data: { doc_count: { increment: 1 } } })
        .catch(() => {});
    }

    await onLibraryCatalogChanged();

    void this.ingest.ingestLibraryDoc(docId).catch(async (err) => {
      console.error('[library.ingest.fail]', docId, err);
      await this.prisma.library_doc
        .updateMany({
          where: { id: docId },
          data: {
            status: 'PROCESSING',
            hidden_reason: `Ingest fail: ${(err as Error).message}`,
          },
        })
        .catch(() => {});
    });

    return {
      docId,
      status: 'PROCESSING',
      message: 'Đang xử lý tài liệu (parse + embed). Tự refresh sau 30s sẽ thấy PUBLISHED.',
    };
  }
}

function inferExt(format: 'pdf' | 'docx' | 'image', filename: string): string {
  if (format === 'pdf') return 'pdf';
  if (format === 'docx') return 'docx';
  const m = filename.match(/\.([a-z]{2,5})$/i);
  return m ? m[1]!.toLowerCase() : 'png';
}
