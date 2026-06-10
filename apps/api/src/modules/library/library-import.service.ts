/**
 * LibraryImportService — clone library doc → workspace documents, port từ:
 *   POST /api/library/docs/[id]/import  (premium gate 402 + rate limit 429)
 *   POST /api/library/import-batch      (bulk, skip duplicates)
 * (apps/web/src/app/api/library/{docs/[id]/import,import-batch}/route.ts)
 *
 * Shallow-copy: link R2 storageKey + bulk copy library_doc_chunk → chunk
 * (giữ embedding cho RAG), KHÔNG duplicate file binary.
 */
import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { onLibraryImportChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { Plan } from '../../infra/ai/cost-guardrail.service';
import { KarmaService } from './karma.service';
import { LibraryAccessService } from './library-access.service';
import { FREE_IMPORTS_PER_DAY, LibraryRateLimitService } from './library-rate-limit.service';

const IMPORT_BODY = z.object({
  workspaceId: z.string().min(1),
});

const BATCH_BODY = z.object({
  workspaceId: z.string().min(1),
  docIds: z.array(z.string().min(1)).min(1).max(10),
  skipDuplicates: z.boolean().default(true),
});

type BatchResult = {
  docId: string;
  ok: boolean;
  documentId?: string;
  title?: string;
  error?: string;
  skippedDuplicate?: boolean;
};

@Injectable()
export class LibraryImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LibraryAccessService,
    private readonly rateLimit: LibraryRateLimitService,
    private readonly karma: KarmaService,
  ) {}

  /** POST docs/:id/import — import 1 doc vào workspace. */
  async importDoc(userId: string, docId: string, raw: unknown) {
    const parsed = IMPORT_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }
    const { workspaceId } = parsed.data;

    // ── Verify library doc PUBLISHED ───────────────────────────────────
    const doc = await this.prisma.library_doc.findFirst({
      where: { id: docId, status: 'PUBLISHED' },
    });
    if (!doc) throw new HttpException({ error: 'Doc not available' }, 404);

    // ── Verify workspace ownership ─────────────────────────────────────
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, user_id: true },
    });
    if (!ws || ws.user_id !== userId) {
      throw new HttpException({ error: 'Workspace forbidden' }, 403);
    }

    // ── Premium gate (block trước rate-limit) ──────────────────────────
    const accessInfo = await this.access.checkDocAccess(docId, userId);
    if (accessInfo && !accessInfo.access.allowed) {
      throw new HttpException(
        { error: 'Premium doc — cần mua trước khi import', reason: accessInfo.access.reason },
        402,
      );
    }

    // ── Rate limit — re-derive plan từ DB (proUntilAt expiry) thay session ─
    const proActive = await this.access.isUserPro(userId);
    const userPlan: Plan = proActive ? 'PRO' : 'FREE';
    const rateLimit = await this.rateLimit.checkImportRateLimit(userId, userPlan);
    if (!rateLimit.allowed) {
      throw new HttpException({ error: rateLimit.reason, rateLimit }, 429);
    }

    // ── Extract R2 storageKey từ doc.file_url ──────────────────────────
    const keyMatch = doc.file_url.match(/\/(lib\/[^/]+\/[^/?]+)/);
    if (!keyMatch || !keyMatch[1]) {
      throw new HttpException({ error: 'Invalid file URL — cannot extract storage key' }, 500);
    }
    const storageKey = keyMatch[1];
    const mimeType = inferMimeType(doc.file_format);

    // ── Atomic txn: INSERT document + copy chunks + track import ───────
    const documentId = randomUUID();
    await this.runImportTxn(this.prisma, {
      documentId,
      userId,
      workspaceId,
      doc: {
        id: doc.id,
        title: doc.title,
        fileFormat: doc.file_format,
        fileSizeBytes: doc.file_size_bytes,
        uploaderId: doc.uploader_id,
      },
      storageKey,
      mimeType,
      importBatch: false,
    });

    // Karma cho uploader (best-effort).
    void this.karma
      .awardKarma({
        userId: doc.uploader_id,
        eventType: 'doc_imported',
        docId,
        context: { importerId: userId, workspaceId },
      })
      .catch((err) => console.error('[karma.import]', err));

    // workspaceImportCount++ → hub-stats totalImports đổi (bust nhẹ).
    await onLibraryImportChanged();

    return {
      ok: true,
      documentId,
      workspaceId,
      title: doc.title,
      message: `Đã thêm "${doc.title}" vào workspace`,
    };
  }

  /** POST import-batch — bulk import ≤10 docs, idempotent skip duplicates. */
  async importBatch(user: { id: string; plan?: string | null }, raw: unknown) {
    const parsed = BATCH_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }
    const { workspaceId, docIds, skipDuplicates } = parsed.data;

    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, user_id: true },
    });
    if (!ws || ws.user_id !== user.id) {
      throw new HttpException({ error: 'Workspace forbidden' }, 403);
    }

    // Rate limit — route cũ dùng plan từ SESSION (không re-derive DB như import đơn).
    const userPlan = (user.plan ?? 'FREE') as Plan;
    const rateLimit = await this.rateLimit.checkImportRateLimit(user.id, userPlan);
    if (userPlan === 'FREE') {
      const remaining = FREE_IMPORTS_PER_DAY - rateLimit.count;
      if (remaining <= 0) {
        throw new HttpException({ error: rateLimit.reason, rateLimit }, 429);
      }
      if (docIds.length > remaining) {
        throw new HttpException(
          {
            error: `Free tier còn ${remaining} slot. Chọn ≤ ${remaining} doc hoặc nâng cấp PRO.`,
            rateLimit,
          },
          429,
        );
      }
    }

    // ── Pre-fetch all docs + existing imports (skip duplicate) ─────────
    const docs = await this.prisma.library_doc.findMany({
      where: { id: { in: docIds }, status: 'PUBLISHED' },
    });
    const byId = new Map(docs.map((d) => [d.id, d]));

    const existing = await this.prisma.library_doc_import.findMany({
      where: { workspace_id: workspaceId, doc_id: { in: docIds } },
      select: { doc_id: true },
    });
    const existingSet = new Set(existing.map((e) => e.doc_id));

    const results: BatchResult[] = [];

    for (const docId of docIds) {
      const doc = byId.get(docId);
      if (!doc) {
        results.push({ docId, ok: false, error: 'Doc not found or not PUBLISHED' });
        continue;
      }

      if (skipDuplicates && existingSet.has(docId)) {
        results.push({ docId, ok: true, title: doc.title, skippedDuplicate: true });
        continue;
      }

      const keyMatch = doc.file_url.match(/\/(lib\/[^/]+\/[^/?]+)/);
      if (!keyMatch || !keyMatch[1]) {
        results.push({ docId, ok: false, error: 'Invalid storage key' });
        continue;
      }
      const storageKey = keyMatch[1];
      const mimeType = inferMimeType(doc.file_format);
      const documentId = randomUUID();

      try {
        await this.runImportTxn(this.prisma, {
          documentId,
          userId: user.id,
          workspaceId,
          doc: {
            id: doc.id,
            title: doc.title,
            fileFormat: doc.file_format,
            fileSizeBytes: doc.file_size_bytes,
            uploaderId: doc.uploader_id,
          },
          storageKey,
          mimeType,
          importBatch: true,
        });
        results.push({ docId, ok: true, documentId, title: doc.title });
      } catch (err) {
        results.push({ docId, ok: false, title: doc.title, error: (err as Error).message });
      }
    }

    await onLibraryImportChanged();

    return {
      results,
      imported: results.filter((r) => r.ok && !r.skippedDuplicate).length,
      skipped: results.filter((r) => r.skippedDuplicate).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

  /**
   * Txn dùng chung import đơn + batch: INSERT document (READY — chunks sẵn,
   * skip pipeline) → bulk INSERT...SELECT chunks → track import → counter++.
   */
  private async runImportTxn(
    prisma: PrismaService,
    args: {
      documentId: string;
      userId: string;
      workspaceId: string;
      doc: {
        id: string;
        title: string;
        fileFormat: string;
        fileSizeBytes: number;
        uploaderId: string;
      };
      storageKey: string;
      mimeType: string;
      importBatch: boolean;
    },
  ): Promise<void> {
    const { documentId, userId, workspaceId, doc, storageKey, mimeType } = args;
    await prisma.$transaction(
      async (tx) => {
        await tx.document.create({
          data: {
            id: documentId,
            user_id: userId,
            workspace_id: workspaceId,
            filename: `${doc.title}.${doc.fileFormat === 'image' ? 'png' : doc.fileFormat}`,
            mime_type: mimeType,
            size: doc.fileSizeBytes,
            storage_key: storageKey, // shared với library — read-only
            status: 'READY',
            metadata: {
              librarySourceDocId: doc.id,
              librarySourceTitle: doc.title,
              librarySourceUploader: doc.uploaderId,
              importedAt: new Date().toISOString(),
              ...(args.importBatch ? { importBatch: true } : {}),
            },
          },
        });

        // Copy library_doc_chunk → workspace chunk (preserve embedding),
        // bulk INSERT...SELECT để giảm round-trip — SQL y route cũ.
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO chunk (id, document_id, content, embedding, metadata, tokens)
          SELECT
            gen_random_uuid()::text,
            ${documentId},
            lc.content,
            lc.content_vec,
            jsonb_build_object(
              'pageNum', lc.page_num,
              'chunkIndex', lc.chunk_index,
              'sourceDocId', ${doc.id}
            ),
            GREATEST(LENGTH(lc.content) / 4, 1)
          FROM library_doc_chunk lc
          WHERE lc.doc_id = ${doc.id}
        `);

        await tx.library_doc_import.create({
          data: {
            id: randomUUID(),
            doc_id: doc.id,
            importer_id: userId,
            workspace_id: workspaceId,
            document_id: documentId,
          },
        });

        await tx.library_doc.update({
          where: { id: doc.id },
          data: { workspace_import_count: { increment: 1 } },
        });
      },
      { timeout: 60_000 }, // chunk copy doc lớn có thể lâu (route cũ maxDuration 60s)
    );
  }
}

function inferMimeType(format: string): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'image':
      return 'image/png'; // best-effort, original có thể khác
    default:
      return 'application/octet-stream';
  }
}
