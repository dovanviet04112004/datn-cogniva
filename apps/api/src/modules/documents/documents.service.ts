import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onDocumentChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { XP_AMOUNTS, XpService } from '../gamification/xp.service';
import { IngestService } from './ingest.service';

type DocumentListRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: string;
  workspaceId: string;
  createdAt: Date;
  pageCount: number | null;
  chunks: number;
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: IngestService,
    private readonly xp: XpService,
  ) {}

  async uploadDocument(
    userId: string,
    input: {
      buffer: Buffer;
      size: number;
      mimeType: string;
      filename: string;
      workspaceId: string;
    },
  ): Promise<{ httpStatus: 200 | 207; body: Record<string, unknown> }> {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: input.workspaceId, user_id: userId },
      select: { id: true, name: true },
    });
    if (!ws) {
      throw new BadRequestException({ error: 'Workspace không tồn tại hoặc không thuộc về bạn' });
    }

    const created = await this.prisma.document.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        workspace_id: ws.id,
        filename: input.filename,
        mime_type: input.mimeType,
        size: input.size,
        storage_key: '',
        status: 'PROCESSING',
        metadata: {},
      },
    });

    const storageKey = `${userId}/${created.id}.pdf`;
    await this.storage.put(storageKey, input.buffer, input.mimeType);
    await this.prisma.document.update({
      where: { id: created.id },
      data: { storage_key: storageKey },
    });

    try {
      await this.ingest.ingestDocument(created.id);
      await this.xp.awardXp(userId, XP_AMOUNTS.DOCUMENT_UPLOAD, {
        source: 'document',
        totalCount: 1,
      });

      await onDocumentChanged(userId, ws.id);

      return {
        httpStatus: 200,
        body: {
          id: created.id,
          filename: input.filename,
          status: 'READY',
          workspaceId: ws.id,
          workspaceName: ws.name,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[upload] ingest failed:', error);
      return {
        httpStatus: 207,
        body: { id: created.id, filename: input.filename, status: 'FAILED', error: message },
      };
    }
  }

  async listDocuments(userId: string) {
    const documents = await cached(ck.documents(userId), 60, async () => {
      return this.prisma.$queryRaw<DocumentListRow[]>(Prisma.sql`
        SELECT
          d.id,
          d.filename,
          d.mime_type AS "mimeType",
          d.size,
          d.status,
          d.workspace_id AS "workspaceId",
          d.created_at AS "createdAt",
          (d.metadata->>'pageCount')::int AS "pageCount",
          coalesce(cc.n, 0)::int AS chunks
        FROM document d
        LEFT JOIN (
          SELECT document_id, count(id) AS n
          FROM chunk
          GROUP BY document_id
        ) cc ON d.id = cc.document_id
        WHERE d.user_id = ${userId}
        ORDER BY d.created_at DESC
        LIMIT 100;
      `);
    });

    return { documents };
  }

  async deleteDocument(userId: string, id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { id: true, user_id: true, storage_key: true, workspace_id: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });
    if (doc.user_id !== userId) throw new ForbiddenException({ error: 'Forbidden' });

    try {
      await this.storage.delete(doc.storage_key);
    } catch (err) {
      console.warn('[api/documents/[id] DELETE] storage delete failed:', err);
    }

    await this.prisma.document.delete({ where: { id } });

    await onDocumentChanged(doc.user_id, doc.workspace_id);

    return { deleted: true };
  }

  async listChunks(userId: string, id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { user_id: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });
    if (doc.user_id !== userId) throw new ForbiddenException({ error: 'Forbidden' });

    const rows = await this.prisma.$queryRaw<
      { id: string; content: string; tokens: number; metadata: unknown }[]
    >(Prisma.sql`
      SELECT id, content, tokens, metadata
      FROM chunk
      WHERE document_id = ${id}
      ORDER BY (metadata->>'chunkIndex')::int ASC NULLS LAST;
    `);

    const chunks = rows.map((c) => {
      const meta = (c.metadata ?? {}) as { page?: number; chunkIndex?: number };
      return {
        id: c.id,
        content: c.content,
        tokens: c.tokens,
        chunkIndex: typeof meta.chunkIndex === 'number' ? meta.chunkIndex : null,
        page: typeof meta.page === 'number' ? meta.page : null,
      };
    });

    return { chunks };
  }

  getDocumentForFile(id: string) {
    return this.prisma.document.findUnique({ where: { id } });
  }

  async moveDocument(userId: string, id: string, workspaceId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, user_id: userId },
      select: { id: true, workspace_id: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });

    const ws = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, user_id: userId },
      select: { id: true },
    });
    if (!ws) throw new ForbiddenException({ error: 'Workspace không thuộc bạn' });

    await this.prisma.document.update({ where: { id }, data: { workspace_id: workspaceId } });

    await onDocumentChanged(userId, doc.workspace_id);
    if (doc.workspace_id !== workspaceId) {
      await onDocumentChanged(userId, workspaceId);
    }

    return { moved: true };
  }
}
