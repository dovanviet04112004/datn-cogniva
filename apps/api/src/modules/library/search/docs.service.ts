import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { cached, cacheVersion } from '@cogniva/server-core/cache/cache-aside';
import { ck, TAG_LIBRARY } from '@cogniva/server-core/cache/keys';
import { onLibraryCatalogChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../../infra/database/prisma.service';

export const NEAR_DUPLICATE_THRESHOLD = 0.92;
export const SIMILAR_THRESHOLD = 0.85;

const THEORY_TYPES = ['lecture_notes', 'summary', 'reference_book', 'handout', 'other'];
const PRACTICE_TYPES = ['exam', 'exercise', 'solution'];

export type RelatedDocRole = 'prerequisite' | 'next_step' | 'practice';

export type RelatedDoc = {
  id: string;
  title: string;
  docType: string;
  pageCount: number | null;
  previewThumbUrl: string | null;
  aiSummary: string | null;
  ratingAvg: number | null;
  qualityScore: number | null;
  workspaceImportCount: number;
  role: RelatedDocRole;
  atomOverlap: number;
};

export type DuplicateMatch = {
  id: string;
  title: string;
  subjectSlug: string;
  uploaderId: string;
  createdAt: Date;
  similarity: number;
  isNearDuplicate: boolean;
};

const REVIEW_BODY = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

type RelatedCandidateRow = {
  id: string;
  title: string;
  doc_type: string;
  page_count: number | null;
  preview_thumb_url: string | null;
  ai_summary: string | null;
  rating_avg: unknown;
  quality_score: unknown;
  workspace_import_count: number;
  atom_overlap: number;
};

@Injectable()
export class LibraryDocsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDocDetail(id: string, userId: string | null) {
    const ver = await cacheVersion(TAG_LIBRARY);
    const detail = await cached(ck.libraryDocDetail(id, ver), 600, async () => {
      const docRow = await this.prisma.library_doc.findUnique({
        where: { id },
        select: {
          id: true,
          uploader_id: true,
          title: true,
          description: true,
          subject_slug: true,
          level: true,
          grade: true,
          doc_type: true,
          exam_type: true,
          school_year: true,
          region: true,
          language: true,
          tags: true,
          file_format: true,
          file_size_bytes: true,
          page_count: true,
          preview_thumb_url: true,
          ai_summary: true,
          preview_text: true,
          license: true,
          status: true,
          view_count: true,
          download_count: true,
          workspace_import_count: true,
          rating_avg: true,
          rating_count: true,
          quality_score: true,
          badges: true,
          parent_remix_doc_ids: true,
          remix_count: true,
          is_premium: true,
          price_vnd: true,
          creator_share_pct: true,
          course_id: true,
          course_name_cache: true,
          university_id: true,
          created_at: true,
          user: { select: { name: true, image: true } },
        },
      });

      if (!docRow) return null;

      let parentRemixDocs: Array<{ id: string; title: string; uploaderName: string | null }> = [];
      if (docRow.parent_remix_doc_ids.length > 0) {
        const parents = await this.prisma.library_doc.findMany({
          where: { id: { in: docRow.parent_remix_doc_ids }, status: 'PUBLISHED' },
          select: { id: true, title: true, user: { select: { name: true } } },
        });
        parentRemixDocs = parents.map((p) => ({
          id: p.id,
          title: p.title,
          uploaderName: p.user.name,
        }));
      }

      let universityName: string | null = null;
      if (docRow.university_id) {
        const uni = await this.prisma.library_university.findUnique({
          where: { id: docRow.university_id },
          select: { name: true, short_name: true },
        });
        universityName = uni?.short_name || uni?.name || null;
      }

      const reviews = await this.fetchReviews(id, 5, 0);

      return {
        doc: {
          id: docRow.id,
          uploaderId: docRow.uploader_id,
          uploaderName: docRow.user.name,
          uploaderImage: docRow.user.image,
          title: docRow.title,
          description: docRow.description,
          subjectSlug: docRow.subject_slug,
          level: docRow.level,
          grade: docRow.grade,
          docType: docRow.doc_type,
          examType: docRow.exam_type,
          schoolYear: docRow.school_year,
          region: docRow.region,
          language: docRow.language,
          tags: docRow.tags,
          fileFormat: docRow.file_format,
          fileSizeBytes: docRow.file_size_bytes,
          pageCount: docRow.page_count,
          previewThumbUrl: docRow.preview_thumb_url,
          aiSummary: docRow.ai_summary,
          previewText: docRow.preview_text,
          license: docRow.license,
          status: docRow.status,
          viewCount: docRow.view_count,
          downloadCount: docRow.download_count,
          workspaceImportCount: docRow.workspace_import_count,
          ratingAvg: docRow.rating_avg ? Number(docRow.rating_avg) : null,
          ratingCount: docRow.rating_count,
          qualityScore: docRow.quality_score ? Number(docRow.quality_score) : null,
          badges: docRow.badges,
          parentRemixDocIds: docRow.parent_remix_doc_ids,
          remixCount: docRow.remix_count,
          isPremium: docRow.is_premium ?? false,
          priceVnd: docRow.price_vnd,
          creatorSharePct: docRow.creator_share_pct,
          courseId: docRow.course_id,
          courseNameCache: docRow.course_name_cache,
          universityId: docRow.university_id,
          createdAt: docRow.created_at,
        },
        parentRemixDocs,
        universityName,
        reviews,
      };
    });

    if (!detail) throw new NotFoundException({ error: 'Not found' });

    const access = await this.accessVerdict(
      {
        id: detail.doc.id,
        uploaderId: detail.doc.uploaderId,
        isPremium: detail.doc.isPremium,
        status: detail.doc.status,
      },
      userId,
    );

    void this.prisma.library_doc
      .update({ where: { id }, data: { view_count: { increment: 1 } } })
      .catch(() => {});

    if (userId && detail.doc.status === 'PUBLISHED') {
      void this.prisma.library_doc_view
        .upsert({
          where: { user_id_doc_id: { user_id: userId, doc_id: id } },
          create: { id: randomUUID(), user_id: userId, doc_id: id, viewed_at: new Date() },
          update: { viewed_at: new Date() },
        })
        .catch(() => {});
    }

    return { ...detail, access };
  }

  private async accessVerdict(
    doc: { id: string; uploaderId: string; isPremium: boolean; status: string | null },
    userId: string | null,
  ): Promise<'free' | 'owner' | 'pro' | 'purchased' | 'denied'> {
    if (!doc.isPremium) {
      if (doc.status === 'PUBLISHED') return 'free';
      if (userId && userId === doc.uploaderId) return 'owner';
      return 'denied';
    }

    if (!userId) return 'denied';
    if (userId === doc.uploaderId) return 'owner';

    const proRow = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, pro_until_at: true },
    });
    const isProActive =
      proRow?.plan === 'PRO' && (proRow.pro_until_at === null || proRow.pro_until_at > new Date());
    if (isProActive) return 'pro';

    const purchase = await this.prisma.library_doc_purchase.findFirst({
      where: { doc_id: doc.id, buyer_id: userId },
      select: { id: true },
    });
    if (purchase) return 'purchased';

    return 'denied';
  }

  async deleteDoc(userId: string, id: string) {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id },
      select: { uploader_id: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });
    if (doc.uploader_id !== userId) throw new ForbiddenException({ error: 'Forbidden' });

    await this.prisma.library_doc.updateMany({
      where: { id, uploader_id: userId },
      data: {
        status: 'HIDDEN',
        hidden_at: new Date(),
        hidden_reason: 'Removed by uploader',
      },
    });

    await onLibraryCatalogChanged();
    return { ok: true };
  }

  async findRelatedDocs(docId: string): Promise<RelatedDoc[]> {
    const source = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: { id: true, subject_slug: true, level: true, grade: true, doc_type: true },
    });
    if (!source) return [];

    const sourceAtoms = await this.prisma.library_doc_atom.findMany({
      where: { doc_id: docId },
      select: { atom_slug: true },
    });
    const atomSlugs = sourceAtoms.map((a) => a.atom_slug);

    const atomArrayLiteral = atomSlugs.length
      ? `{${atomSlugs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
      : '{}';
    const overlapExpr = atomSlugs.length
      ? Prisma.sql`(SELECT COUNT(DISTINCT a.atom_slug)::int FROM library_doc_atom a WHERE a.doc_id = tp.id AND a.atom_slug = ANY(${atomArrayLiteral}::text[]))`
      : Prisma.sql`0::int`;

    const candidates = await this.prisma.$queryRaw<RelatedCandidateRow[]>(Prisma.sql`
      SELECT DISTINCT ON (tp.id)
        tp.id, tp.title, tp.doc_type, tp.page_count, tp.preview_thumb_url,
        tp.ai_summary, tp.rating_avg, tp.quality_score, tp.workspace_import_count,
        ${overlapExpr} AS atom_overlap
      FROM library_doc tp
      WHERE tp.subject_slug = ${source.subject_slug}
        AND tp.status = 'PUBLISHED'
        AND tp.id <> ${docId}
      ORDER BY tp.id, tp.quality_score DESC
      LIMIT 40`);

    const sortFn = (a: RelatedCandidateRow, b: RelatedCandidateRow) => {
      const ovA = Number(a.atom_overlap ?? 0);
      const ovB = Number(b.atom_overlap ?? 0);
      if (ovA !== ovB) return ovB - ovA;
      const qA = a.quality_score ? Number(a.quality_score) : 0;
      const qB = b.quality_score ? Number(b.quality_score) : 0;
      return qB - qA;
    };

    const practice = candidates.filter((c) => PRACTICE_TYPES.includes(c.doc_type)).sort(sortFn);
    const theory = candidates.filter((c) => THEORY_TYPES.includes(c.doc_type)).sort(sortFn);

    const prerequisite = theory[0];
    const nextStep = theory.find((c) => c.id !== prerequisite?.id);
    const practiceTop = practice[0];

    const results: RelatedDoc[] = [];
    if (prerequisite) results.push(toRelatedDoc(prerequisite, 'prerequisite'));
    if (nextStep) results.push(toRelatedDoc(nextStep, 'next_step'));
    if (practiceTop) results.push(toRelatedDoc(practiceTop, 'practice'));
    return results;
  }

  async findDuplicateMatches(
    sourceDocId: string,
    threshold: number = SIMILAR_THRESHOLD,
  ): Promise<DuplicateMatch[]> {
    const sources = await this.prisma.$queryRaw<
      Array<{ title_embedding: string | null; subject_slug: string }>
    >(Prisma.sql`
      SELECT title_embedding::text AS title_embedding, subject_slug
      FROM library_doc WHERE id = ${sourceDocId} LIMIT 1`);
    const source = sources[0];
    if (!source || !source.title_embedding) return [];

    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        subject_slug: string;
        uploader_id: string;
        created_at: Date;
        similarity: number;
      }>
    >(Prisma.sql`
      SELECT tp.id, tp.title, tp.subject_slug, tp.uploader_id, tp.created_at,
        (1 - (tp.title_embedding <=> ${source.title_embedding}::vector))::float AS similarity
      FROM library_doc tp
      WHERE tp.status = 'PUBLISHED'
        AND tp.id <> ${sourceDocId}
        AND tp.subject_slug = ${source.subject_slug}
        AND tp.title_embedding IS NOT NULL
      ORDER BY tp.title_embedding <=> ${source.title_embedding}::vector
      LIMIT 5`);

    return results
      .map((r) => ({
        id: r.id,
        title: r.title,
        subjectSlug: r.subject_slug,
        uploaderId: r.uploader_id,
        createdAt: r.created_at,
        similarity: Number(r.similarity),
        isNearDuplicate: Number(r.similarity) >= NEAR_DUPLICATE_THRESHOLD,
      }))
      .filter((r) => r.similarity >= threshold);
  }

  async prereqCheck(id: string, userId: string | null) {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id },
      select: { prerequisite_atom_slugs: true, difficulty: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });

    const prereqs = doc.prerequisite_atom_slugs ?? [];
    if (prereqs.length === 0) {
      return { prereqs: [], missing: [], hasGap: false, difficulty: doc.difficulty };
    }

    let missing: string[] = [];
    if (userId) {
      missing = await this.findMissingPrereqs(id, userId);
    }

    return { prereqs, missing, hasGap: missing.length > 0, difficulty: doc.difficulty };
  }

  private async findMissingPrereqs(docId: string, userId: string): Promise<string[]> {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: { prerequisite_atom_slugs: true },
    });
    const prereqSlugs = doc?.prerequisite_atom_slugs;
    if (!prereqSlugs || prereqSlugs.length === 0) return [];

    const slugList = prereqSlugs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',');

    const masteredRows = await this.prisma.$queryRaw<Array<{ atom_slug: string }>>(Prisma.sql`
      SELECT DISTINCT atom_slug
      FROM library_doc_atom a
      JOIN library_doc_import imp ON imp.doc_id = a.doc_id
      WHERE imp.importer_id = ${userId}
        AND atom_slug = ANY(('{' || ${slugList} || '}')::text[])
    `);
    const masteredSlugs = new Set(masteredRows.map((r) => r.atom_slug));

    return prereqSlugs.filter((s) => !masteredSlugs.has(s));
  }

  async listReviews(docId: string, limit: number, offset: number) {
    return { reviews: await this.fetchReviews(docId, limit, offset) };
  }

  async postReview(userId: string, docId: string, raw: unknown) {
    const parsed = REVIEW_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { rating, comment } = parsed.data;

    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: { id: true, uploader_id: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });
    if (doc.uploader_id === userId) {
      throw new BadRequestException({ error: 'Không thể tự review tài liệu của mình' });
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.library_doc_review.findFirst({
        where: { doc_id: docId, reviewer_id: userId },
        select: { id: true },
      });

      if (existing) {
        await tx.library_doc_review.update({
          where: { id: existing.id },
          data: { rating, comment: comment ?? null },
        });
      } else {
        await tx.library_doc_review.create({
          data: {
            id: randomUUID(),
            doc_id: docId,
            reviewer_id: userId,
            rating,
            comment: comment ?? null,
          },
        });
      }

      const aggRows = await tx.$queryRaw<Array<{ avg: string | null; count: number }>>(Prisma.sql`
        SELECT AVG(rating)::text AS avg, COUNT(*)::int AS count
        FROM library_doc_review WHERE doc_id = ${docId}`);
      const agg = aggRows[0];
      if (agg) {
        await tx.library_doc.update({
          where: { id: docId },
          data: {
            rating_avg: agg.avg ? String(Number(agg.avg).toFixed(2)) : null,
            rating_count: agg.count,
          },
        });
      }
    });

    return { ok: true };
  }

  private async fetchReviews(docId: string, limit: number, offset: number) {
    const rows = await this.prisma.library_doc_review.findMany({
      where: { doc_id: docId },
      orderBy: [{ helpful_count: 'desc' }, { created_at: 'desc' }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        rating: true,
        comment: true,
        helpful_count: true,
        created_at: true,
        user: { select: { name: true, image: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      helpfulCount: r.helpful_count,
      createdAt: r.created_at,
      reviewerName: r.user.name,
      reviewerImage: r.user.image,
    }));
  }
}

function toRelatedDoc(c: RelatedCandidateRow, role: RelatedDocRole): RelatedDoc {
  return {
    id: c.id,
    title: c.title,
    docType: c.doc_type,
    pageCount: c.page_count,
    previewThumbUrl: c.preview_thumb_url,
    aiSummary: c.ai_summary,
    ratingAvg: c.rating_avg ? Number(c.rating_avg) : null,
    qualityScore: c.quality_score ? Number(c.quality_score) : null,
    workspaceImportCount: c.workspace_import_count,
    role,
    atomOverlap: Number(c.atom_overlap ?? 0),
  };
}

function sortNumArr(arr: number[] | undefined): number[] | null {
  return arr && arr.length > 0 ? [...arr].sort((a, b) => a - b) : null;
}
