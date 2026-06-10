/**
 * POST /api/library/docs/[id]/import — Library V1 (2026-05-22).
 *
 * Clone library doc → workspace.documents để user dùng AI chat / flashcard /
 * quiz từ doc đó. Pattern: shallow-copy (link R2 storageKey, không duplicate
 * file binary) + reuse workspace document chunks (đã ingest sẵn).
 *
 * Flow atomic:
 *   1. Verify doc PUBLISHED + user có quyền (free tier 5/day Phase 4)
 *   2. INSERT document row vào workspace với storage_key = library R2 key
 *   3. Copy library_doc_chunk → workspace chunk (cùng embedding để search RAG)
 *   4. INSERT library_doc_import (track stat)
 *   5. UPDATE library_doc.workspace_import_count++
 *
 * Spec: docs/plans/library-share.md §Clone Flow.
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  chunk,
  db,
  document,
  libraryDoc,
  libraryDocChunk,
  libraryDocImport,
  workspace,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onLibraryImportChanged } from '@/lib/cache/invalidate';
import { checkDocAccess, isUserPro } from '@/lib/library/access';
import { checkImportRateLimit } from '@/lib/library/rate-limit';
import type { Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const BODY = z.object({
  workspaceId: z.string().min(1),
});

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: docId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { workspaceId } = parsed.data;

  // ── Verify library doc PUBLISHED ───────────────────────────────────
  const [doc] = await db
    .select()
    .from(libraryDoc)
    .where(and(eq(libraryDoc.id, docId), eq(libraryDoc.status, 'PUBLISHED')))
    .limit(1);
  if (!doc) {
    return NextResponse.json(
      { error: 'Doc not available' },
      { status: 404 },
    );
  }

  // ── Verify workspace ownership ────────────────────────────────────
  const [ws] = await db
    .select({ id: workspace.id, userId: workspace.userId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!ws || ws.userId !== session.user.id) {
    return NextResponse.json({ error: 'Workspace forbidden' }, { status: 403 });
  }

  // ── Phase 4 Step 5 — premium gate (block trước rate-limit) ────────
  const accessInfo = await checkDocAccess(docId, session.user.id);
  if (accessInfo && !accessInfo.access.allowed) {
    return NextResponse.json(
      {
        error: 'Premium doc — cần mua trước khi import',
        reason: accessInfo.access.reason,
      },
      { status: 402 },
    );
  }

  // ── Rate limit check (Phase 4) — Free 5/day, PRO unlimited ────────
  // Re-derive plan từ DB (proUntilAt expiry check) thay vì session cache.
  const proActive = await isUserPro(session.user.id);
  const userPlan: Plan = proActive ? 'PRO' : 'FREE';
  const rateLimit = await checkImportRateLimit(session.user.id, userPlan);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: rateLimit.reason,
        rateLimit,
      },
      { status: 429 },
    );
  }

  // ── Extract R2 storageKey từ doc.file_url ─────────────────────────
  const keyMatch = doc.fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
  if (!keyMatch || !keyMatch[1]) {
    return NextResponse.json(
      { error: 'Invalid file URL — cannot extract storage key' },
      { status: 500 },
    );
  }
  const storageKey = keyMatch[1];
  const mimeType = inferMimeType(doc.fileFormat);

  // ── Atomic txn: INSERT document + copy chunks + track import ──────
  const documentId = randomUUID();
  await db.transaction(async (tx) => {
    // 1. INSERT document — status=READY vì chunks đã có sẵn (skip pipeline)
    await tx.insert(document).values({
      id: documentId,
      userId: session.user.id,
      workspaceId,
      filename: `${doc.title}.${doc.fileFormat === 'image' ? 'png' : doc.fileFormat}`,
      mimeType,
      size: doc.fileSizeBytes,
      storageKey, // shared với library — read-only
      status: 'READY',
      metadata: {
        librarySourceDocId: doc.id,
        librarySourceTitle: doc.title,
        librarySourceUploader: doc.uploaderId,
        importedAt: new Date().toISOString(),
      } as Record<string, unknown>,
    });

    // 2. Copy library_doc_chunk → workspace chunk (preserve embedding)
    // Bulk INSERT...SELECT để giảm round-trip
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

    // 3. Track import
    await tx.insert(libraryDocImport).values({
      docId,
      importerId: session.user.id,
      workspaceId,
      documentId,
    });

    // 4. Increment counter
    await tx
      .update(libraryDoc)
      .set({
        workspaceImportCount: sql`${libraryDoc.workspaceImportCount} + 1`,
      })
      .where(eq(libraryDoc.id, docId));
  });

  // Phase 3 Bonus #12: award karma cho uploader (best-effort).
  void import('@/lib/library/karma').then(({ awardKarma }) =>
    awardKarma({
      userId: doc.uploaderId,
      eventType: 'doc_imported',
      docId,
      context: { importerId: session.user.id, workspaceId },
    }).catch((err) => console.error('[karma.import]', err)),
  );

  // workspaceImportCount++ → hub-stats totalImports đổi (bust nhẹ, không nuke catalog version).
  await onLibraryImportChanged();

  return NextResponse.json({
    ok: true,
    documentId,
    workspaceId,
    title: doc.title,
    message: `Đã thêm "${doc.title}" vào workspace`,
  });
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
