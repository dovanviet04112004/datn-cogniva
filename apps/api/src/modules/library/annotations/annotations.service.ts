import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { annotationBodySchema } from './dto/annotations.dto';

type AnnotationRow = {
  id: string;
  pageNum: number;
  note: string;
  selectedText: string | null;
  selectionRect: unknown;
  visibility: string;
  helpfulCount: number;
  createdAt: Date;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  hasVoted: boolean;
};

@Injectable()
export class LibraryAnnotationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForDoc(docId: string, userId: string | null) {
    const visibilityCond = userId
      ? Prisma.sql`(a."visibility" = 'public' OR a."author_id" = ${userId})`
      : Prisma.sql`a."visibility" = 'public'`;
    const hasVotedExpr = userId
      ? Prisma.sql`EXISTS(SELECT 1 FROM library_doc_annotation_vote v WHERE v.annotation_id = a."id" AND v.user_id = ${userId})`
      : Prisma.sql`false`;

    const rows = await this.prisma.$queryRaw<AnnotationRow[]>(Prisma.sql`
      SELECT
        a."id",
        a."page_num" AS "pageNum",
        a."note",
        a."selected_text" AS "selectedText",
        a."selection_rect" AS "selectionRect",
        a."visibility",
        a."helpful_count" AS "helpfulCount",
        a."created_at" AS "createdAt",
        a."author_id" AS "authorId",
        u."name" AS "authorName",
        u."image" AS "authorImage",
        ${hasVotedExpr} AS "hasVoted"
      FROM "library_doc_annotation" a
      LEFT JOIN "user" u ON u."id" = a."author_id"
      WHERE a."doc_id" = ${docId} AND ${visibilityCond}
      ORDER BY a."helpful_count" DESC, a."created_at" DESC
      LIMIT 100
    `);

    return { annotations: rows, total: rows.length, viewerId: userId };
  }

  async createAnnotation(userId: string, docId: string, raw: unknown) {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: { id: true, status: true, page_count: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });
    if (doc.status !== 'PUBLISHED') {
      throw new ForbiddenException({ error: 'Not available' });
    }

    const parsed = annotationBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    if (doc.page_count && parsed.data.pageNum > doc.page_count) {
      throw new BadRequestException({ error: `Doc chỉ có ${doc.page_count} trang` });
    }

    const annotationId = randomUUID();
    await this.prisma.library_doc_annotation.create({
      data: {
        id: annotationId,
        doc_id: docId,
        author_id: userId,
        page_num: parsed.data.pageNum,
        note: parsed.data.note,
        visibility: parsed.data.visibility,
        selected_text: parsed.data.selectedText ?? null,
        selection_rect:
          (parsed.data.selectionRect as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
      },
    });

    return { ok: true, id: annotationId };
  }

  async deleteAnnotation(userId: string, id: string) {
    const result = await this.prisma.library_doc_annotation.deleteMany({
      where: { id, author_id: userId },
    });
    if (result.count === 0) {
      throw new NotFoundException({ error: 'Not found or forbidden' });
    }
    return { ok: true };
  }

  async vote(userId: string, annotationId: string) {
    const ann = await this.prisma.library_doc_annotation.findUnique({
      where: { id: annotationId },
      select: { id: true },
    });
    if (!ann) throw new NotFoundException({ error: 'Not found' });

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.library_doc_annotation_vote.findFirst({
        where: { annotation_id: annotationId, user_id: userId },
        select: { id: true },
      });

      if (existing) {
        await tx.library_doc_annotation_vote.delete({ where: { id: existing.id } });
        const [updated] = await tx.$queryRaw<Array<{ helpfulCount: number }>>(Prisma.sql`
          UPDATE "library_doc_annotation"
          SET "helpful_count" = GREATEST("helpful_count" - 1, 0)
          WHERE "id" = ${annotationId}
          RETURNING "helpful_count" AS "helpfulCount"
        `);
        return { voted: false, helpfulCount: updated?.helpfulCount ?? 0 };
      }

      await tx.library_doc_annotation_vote.create({
        data: { id: randomUUID(), annotation_id: annotationId, user_id: userId },
      });
      const [updated] = await tx.$queryRaw<Array<{ helpfulCount: number }>>(Prisma.sql`
        UPDATE "library_doc_annotation"
        SET "helpful_count" = "helpful_count" + 1
        WHERE "id" = ${annotationId}
        RETURNING "helpful_count" AS "helpfulCount"
      `);
      return { voted: true, helpfulCount: updated?.helpfulCount ?? 1 };
    });
  }
}
