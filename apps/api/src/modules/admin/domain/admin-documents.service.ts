import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { doc_status, Prisma } from '@prisma/client';

import { DOCUMENT_QUEUE } from '../../../infra/queue/queue.module';
import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import { clampLimit, parseCursor } from './dto/admin-domain.dto';

const DOC_STATUSES = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'] as const;

@Injectable()
export class AdminDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    @InjectQueue(DOCUMENT_QUEUE) private readonly documentQueue: Queue,
  ) {}

  async list(params: {
    q?: string;
    status?: string;
    mime?: string;
    userEmail?: string;
    cursor?: string;
    limit?: string;
  }) {
    const q = params.q?.trim() ?? '';
    const mime = params.mime?.trim() ?? '';
    const userEmail = params.userEmail?.trim() ?? '';
    const limit = clampLimit(params.limit, 50, 100);

    const where: Prisma.documentWhereInput = {};
    let conditions = 0;
    if (q) {
      where.filename = { contains: q, mode: 'insensitive' };
      conditions++;
    }
    if ((DOC_STATUSES as readonly string[]).includes(params.status ?? '')) {
      where.status = params.status as doc_status;
      conditions++;
    }
    if (mime) {
      where.mime_type = { contains: mime, mode: 'insensitive' };
      conditions++;
    }
    if (userEmail) {
      where.user = { email: { contains: userEmail, mode: 'insensitive' } };
      conditions++;
    }
    const cursorDate = parseCursor(params.cursor);
    if (cursorDate) {
      where.created_at = { lt: cursorDate };
      conditions++;
    }

    const rows = await this.prisma.document.findMany({
      where,
      select: {
        id: true,
        filename: true,
        mime_type: true,
        size: true,
        status: true,
        created_at: true,
        user_id: true,
        workspace_id: true,
        user: { select: { name: true, email: true } },
        workspace: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1]!.created_at.toISOString() : null;

    let total: number | null = null;
    if (conditions === 0) {
      total = await this.prisma.document.count();
    }

    return {
      documents: trimmed.map((d) => ({
        id: d.id,
        filename: d.filename,
        mimeType: d.mime_type,
        size: d.size,
        status: d.status,
        createdAt: d.created_at.toISOString(),
        userId: d.user_id,
        userName: d.user.name,
        userEmail: d.user.email,
        workspaceId: d.workspace_id,
        workspaceName: d.workspace.name,
      })),
      nextCursor,
      total,
    };
  }

  async getDetail(id: string) {
    const row = await this.prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        filename: true,
        mime_type: true,
        size: true,
        status: true,
        storage_key: true,
        metadata: true,
        created_at: true,
        user_id: true,
        workspace_id: true,
        user: { select: { name: true, email: true } },
        workspace: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundException({ error: 'Document not found' });

    const [stats, chunks] = await Promise.all([
      this.prisma.chunk.aggregate({
        where: { document_id: id },
        _count: { _all: true },
        _sum: { tokens: true },
      }),
      this.prisma.chunk.findMany({
        where: { document_id: id },
        select: { id: true, content: true, tokens: true, metadata: true },
        orderBy: { tokens: 'desc' },
        take: 20,
      }),
    ]);

    return {
      document: {
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type,
        size: row.size,
        status: row.status,
        storageKey: row.storage_key,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
        userId: row.user_id,
        userName: row.user.name,
        userEmail: row.user.email,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace.name,
      },
      chunks: chunks.map((c) => ({
        id: c.id,
        preview: c.content.slice(0, 240),
        tokens: c.tokens,
        metadata: c.metadata,
      })),
      stats: {
        chunkCount: stats._count._all,
        tokenTotal: stats._sum.tokens ?? 0,
      },
    };
  }

  async delete(ctx: AdminContext, id: string, reason: string) {
    return this.audit.withAudit(ctx, 'document.delete', { type: 'document', id }, async () => {
      const before = await this.prisma.document.findUnique({
        where: { id },
        select: { id: true, filename: true, user_id: true },
      });
      if (!before) throw new Error('Document not found');

      await this.prisma.document.delete({ where: { id } });

      return {
        before: { id: before.id, filename: before.filename, userId: before.user_id },
        after: null,
        reason,
        result: { ok: true },
      };
    });
  }

  async reingest(ctx: AdminContext, id: string, reason: string) {
    const result = await this.audit.withAudit(
      ctx,
      'document.reingest',
      { type: 'document', id },
      async () => {
        const before = await this.prisma.document.findUnique({
          where: { id },
          select: { id: true, status: true, filename: true },
        });
        if (!before) throw new Error('Document not found');

        await this.prisma.chunk.deleteMany({ where: { document_id: id } });
        await this.prisma.document.update({
          where: { id },
          data: { status: 'PROCESSING' },
        });

        return {
          before,
          after: { status: 'PROCESSING' },
          reason,
          result: { ok: true, started: true },
        };
      },
    );

    void this.enqueueIngest(id);

    return result;
  }

  private async enqueueIngest(documentId: string): Promise<void> {
    try {
      await this.documentQueue.remove(documentId).catch(() => {});
      await this.documentQueue.add(
        'ingest-document',
        { documentId },
        { jobId: documentId, removeOnComplete: 100, removeOnFail: 500 },
      );
    } catch (err) {
      console.error('[admin reingest] enqueue failed:', err);
    }
  }
}
