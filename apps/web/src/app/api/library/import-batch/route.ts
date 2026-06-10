/**
 * POST /api/library/import-batch — Bonus #10 bulk import (Phase 2, 2026-05-27).
 *
 * Import nhiều library docs cùng lúc vào 1 workspace, dùng cho UX
 * "Thêm hết doc gốc + 3 doc bổ trợ".
 *
 * Body: { workspaceId, docIds: [string], skipDuplicates?: boolean }
 *
 * Idempotent: nếu workspace đã import doc (cùng doc_id) thì skip (default true).
 *
 * Trả về { results: [{docId, ok, documentId?, error?}], imported: number }.
 *
 * Spec: docs/plans/library-share.md §Bonus 10.
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  document,
  libraryDoc,
  libraryDocImport,
  workspace,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onLibraryImportChanged } from '@/lib/cache/invalidate';
import { checkImportRateLimit, FREE_IMPORTS_PER_DAY } from '@/lib/library/rate-limit';
import type { Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';
export const maxDuration = 120;

const BODY = z.object({
  workspaceId: z.string().min(1),
  docIds: z.array(z.string().min(1)).min(1).max(10),
  skipDuplicates: z.boolean().default(true),
});

type Result = {
  docId: string;
  ok: boolean;
  documentId?: string;
  title?: string;
  error?: string;
  skippedDuplicate?: boolean;
};

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { workspaceId, docIds, skipDuplicates } = parsed.data;

  // ── Verify workspace ownership ────────────────────────────────────
  const [ws] = await db
    .select({ id: workspace.id, userId: workspace.userId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!ws || ws.userId !== session.user.id) {
    return NextResponse.json({ error: 'Workspace forbidden' }, { status: 403 });
  }

  // ── Rate limit check ─ Free user: bulk import bị giới hạn theo remaining quota
  const userPlan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  const rateLimit = await checkImportRateLimit(session.user.id, userPlan);
  if (userPlan === 'FREE') {
    const remaining = FREE_IMPORTS_PER_DAY - rateLimit.count;
    if (remaining <= 0) {
      return NextResponse.json(
        {
          error: rateLimit.reason,
          rateLimit,
        },
        { status: 429 },
      );
    }
    if (docIds.length > remaining) {
      return NextResponse.json(
        {
          error: `Free tier còn ${remaining} slot. Chọn ≤ ${remaining} doc hoặc nâng cấp PRO.`,
          rateLimit,
        },
        { status: 429 },
      );
    }
  }

  // ── Pre-fetch all docs ────────────────────────────────────────────
  const docs = await db
    .select()
    .from(libraryDoc)
    .where(and(inArray(libraryDoc.id, docIds), eq(libraryDoc.status, 'PUBLISHED')));
  const byId = new Map(docs.map((d) => [d.id, d]));

  // Find existing imports cho workspace để skip duplicate
  const existing = await db
    .select({ docId: libraryDocImport.docId })
    .from(libraryDocImport)
    .where(
      and(
        eq(libraryDocImport.workspaceId, workspaceId),
        inArray(libraryDocImport.docId, docIds),
      ),
    );
  const existingSet = new Set(existing.map((e) => e.docId));

  const results: Result[] = [];

  for (const docId of docIds) {
    const doc = byId.get(docId);
    if (!doc) {
      results.push({ docId, ok: false, error: 'Doc not found or not PUBLISHED' });
      continue;
    }

    if (skipDuplicates && existingSet.has(docId)) {
      results.push({
        docId,
        ok: true,
        title: doc.title,
        skippedDuplicate: true,
      });
      continue;
    }

    const keyMatch = doc.fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
    if (!keyMatch || !keyMatch[1]) {
      results.push({ docId, ok: false, error: 'Invalid storage key' });
      continue;
    }
    const storageKey = keyMatch[1];
    const mimeType = inferMimeType(doc.fileFormat);
    const documentId = randomUUID();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(document).values({
          id: documentId,
          userId: session.user.id,
          workspaceId,
          filename: `${doc.title}.${doc.fileFormat === 'image' ? 'png' : doc.fileFormat}`,
          mimeType,
          size: doc.fileSizeBytes,
          storageKey,
          status: 'READY',
          metadata: {
            librarySourceDocId: doc.id,
            librarySourceTitle: doc.title,
            librarySourceUploader: doc.uploaderId,
            importedAt: new Date().toISOString(),
            importBatch: true,
          } as Record<string, unknown>,
        });

        await tx.execute(sql`
          INSERT INTO chunk (id, document_id, content, embedding, metadata, tokens)
          SELECT
            gen_random_uuid()::text,
            ${documentId},
            lc.content,
            lc.content_vec,
            jsonb_build_object(
              'pageNum', lc.page_num,
              'chunkIndex', lc.chunk_index,
              'sourceDocId', ${docId}
            ),
            GREATEST(LENGTH(lc.content) / 4, 1)
          FROM library_doc_chunk lc
          WHERE lc.doc_id = ${docId}
        `);

        await tx.insert(libraryDocImport).values({
          docId,
          importerId: session.user.id,
          workspaceId,
          documentId,
        });

        await tx
          .update(libraryDoc)
          .set({
            workspaceImportCount: sql`${libraryDoc.workspaceImportCount} + 1`,
          })
          .where(eq(libraryDoc.id, docId));
      });

      results.push({ docId, ok: true, documentId, title: doc.title });
    } catch (err) {
      results.push({
        docId,
        ok: false,
        title: doc.title,
        error: (err as Error).message,
      });
    }
  }

  await onLibraryImportChanged();

  return NextResponse.json({
    results,
    imported: results.filter((r) => r.ok && !r.skippedDuplicate).length,
    skipped: results.filter((r) => r.skippedDuplicate).length,
    failed: results.filter((r) => !r.ok).length,
  });
}

function inferMimeType(format: string): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'image':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}
