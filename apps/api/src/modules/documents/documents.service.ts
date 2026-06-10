/**
 * DocumentsService — list/delete/chunks/file/move, port từ
 * apps/web/src/app/api/documents/** — GIỮ NGUYÊN wire shape (camelCase alias
 * như Drizzle cũ, kể cả thứ tự field) + cache key/TTL/invalidator
 * (ck.documents 60s, onDocumentChanged) để Next/Nest sống chung không lệch.
 *
 * Route cũ đọc list/chunks qua dbReplica; api hiện chỉ có 1 PrismaClient
 * (primary) — chấp nhận trong giai đoạn strangler-fig (như search.service.ts).
 */
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

/** Row GET /documents — alias camelCase đặt ngay trong SQL, thứ tự y route cũ. */
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

  /**
   * POST /documents/upload (bước 4-5 route cũ): verify workspace BẮT BUỘC do
   * user chọn, lưu file, chạy ingest ĐỒNG BỘ. Trả status động:
   *   200 {id, filename, status:'READY', workspaceId, workspaceName}
   *   207 {id, filename, status:'FAILED', error} — file đã lưu nhưng ingest fail
   * Validation request (multipart/size/mime) nằm ở controller — y thứ tự cũ.
   */
  async uploadDocument(
    userId: string,
    input: { buffer: Buffer; size: number; mimeType: string; filename: string; workspaceId: string },
  ): Promise<{ httpStatus: 200 | 207; body: Record<string, unknown> }> {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: input.workspaceId, user_id: userId },
      select: { id: true, name: true },
    });
    if (!ws) {
      throw new BadRequestException({ error: 'Workspace không tồn tại hoặc không thuộc về bạn' });
    }

    // Tạo document trước để có ID làm storage key (id app-side như cuid2 cũ).
    const created = await this.prisma.document.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        workspace_id: ws.id,
        filename: input.filename,
        mime_type: input.mimeType,
        size: input.size,
        // Tạm storageKey rỗng, update ngay sau khi có ID
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
      // Gamification: +20 XP cho mỗi upload thành công
      await this.xp.awardXp(userId, XP_AMOUNTS.DOCUMENT_UPLOAD, {
        source: 'document',
        totalCount: 1,
      });

      // Bust cache SAU khi doc đã READY, TRƯỚC khi trả response (awardXp chỉ
      // xoá dashboard/profile — KHÔNG phủ list/sidebar nên call này bắt buộc).
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
      // Multi-status: file đã lưu nhưng pipeline fail — UI hiển thị FAILED badge
      return {
        httpStatus: 207,
        body: { id: created.id, filename: input.filename, status: 'FAILED', error: message },
      };
    }
  }

  /**
   * GET /documents — list kèm chunkCount, mới nhất trước, limit cứng 100.
   * Cache-aside per-user TTL 60s làm lưới an toàn nếu sót invalidation
   * (các route ghi đã wire onDocumentChanged). cached() fail-open sẵn.
   */
  async listDocuments(userId: string) {
    const documents = await cached(ck.documents(userId), 60, async () => {
      // Subquery đếm chunk theo document_id — tránh N+1; cast ::int chống BigInt.
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

  /**
   * DELETE /documents/:id — verify owner (chống IDOR), best-effort xoá storage,
   * xoá row (chunks cascade theo FK), bust cache.
   */
  async deleteDocument(userId: string, id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { id: true, user_id: true, storage_key: true, workspace_id: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });
    if (doc.user_id !== userId) throw new ForbiddenException({ error: 'Forbidden' });

    // Best-effort xoá storage file — không fail nếu file biến mất
    try {
      await this.storage.delete(doc.storage_key);
    } catch (err) {
      console.warn('[api/documents/[id] DELETE] storage delete failed:', err);
    }

    await this.prisma.document.delete({ where: { id } });

    await onDocumentChanged(doc.user_id, doc.workspace_id);

    return { deleted: true };
  }

  /**
   * GET /documents/:id/chunks — toàn bộ chunks sort theo metadata.chunkIndex
   * ASC NULLS LAST (vị trí đọc — KHÔNG sort theo id vì cuid2 random).
   */
  async listChunks(userId: string, id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { user_id: true },
    });
    if (!doc) throw new NotFoundException({ error: 'Not found' });
    if (doc.user_id !== userId) throw new ForbiddenException({ error: 'Forbidden' });

    // ORDER BY expression jsonb → raw SQL (Prisma orderBy không hỗ trợ).
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

  /** Load full document row cho file proxy (controller tự xử ownership + stream). */
  getDocumentForFile(id: string) {
    return this.prisma.document.findUnique({ where: { id } });
  }

  /**
   * POST /documents/:id/move — chuyển document sang workspace khác (cùng user).
   * Bust cache CẢ workspace nguồn lẫn đích sau khi move.
   */
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
