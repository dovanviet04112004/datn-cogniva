/**
 * GET /api/chunks/[id] — full chunk content + document meta + neighbors.
 *
 * V8 (2026-05-20): dùng cho DocPreviewPanel inline khi user click citation.
 * Trước đây citation chỉ có snippet 240 ký tự; giờ load full + chunks
 * trước/sau cùng document để user đọc context mà không phải navigate
 * sang `/documents/[id]` full page.
 *
 * Output:
 *   {
 *     chunk: { id, content, page, chunkIndex },
 *     document: { id, filename, workspaceId, workspaceName? },
 *     prev: { id, page, chunkIndex } | null,
 *     next: { id, page, chunkIndex } | null,
 *   }
 *
 * Bảo mật: scope theo document.userId.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';

import { chunk, db, document, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [row] = await db
    .select({
      chunkId: chunk.id,
      content: chunk.content,
      metadata: chunk.metadata,
      docId: document.id,
      filename: document.filename,
      docWorkspaceId: document.workspaceId,
      docUserId: document.userId,
      workspaceName: workspace.name,
    })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .leftJoin(workspace, eq(workspace.id, document.workspaceId))
    .where(eq(chunk.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.docUserId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Extract chunkIndex + page từ metadata jsonb
  const meta = (row.metadata ?? {}) as { chunkIndex?: number; page?: number };
  const chunkIndex = typeof meta.chunkIndex === 'number' ? meta.chunkIndex : null;
  const page = typeof meta.page === 'number' ? meta.page : null;

  // Tìm prev/next chunk dựa trên chunkIndex (metadata jsonb)
  let prev: { id: string; chunkIndex: number; page: number | null } | null = null;
  let next: { id: string; chunkIndex: number; page: number | null } | null = null;
  if (chunkIndex !== null) {
    const indexExpr = sql<number>`(${chunk.metadata}->>'chunkIndex')::int`;
    const [prevRow] = await db
      .select({
        id: chunk.id,
        chunkIndex: indexExpr,
        metadata: chunk.metadata,
      })
      .from(chunk)
      .where(and(eq(chunk.documentId, row.docId), lt(indexExpr, chunkIndex)))
      .orderBy(desc(indexExpr))
      .limit(1);
    if (prevRow) {
      const pm = (prevRow.metadata ?? {}) as { page?: number };
      prev = {
        id: prevRow.id,
        chunkIndex: prevRow.chunkIndex,
        page: typeof pm.page === 'number' ? pm.page : null,
      };
    }
    const [nextRow] = await db
      .select({
        id: chunk.id,
        chunkIndex: indexExpr,
        metadata: chunk.metadata,
      })
      .from(chunk)
      .where(and(eq(chunk.documentId, row.docId), gt(indexExpr, chunkIndex)))
      .orderBy(asc(indexExpr))
      .limit(1);
    if (nextRow) {
      const nm = (nextRow.metadata ?? {}) as { page?: number };
      next = {
        id: nextRow.id,
        chunkIndex: nextRow.chunkIndex,
        page: typeof nm.page === 'number' ? nm.page : null,
      };
    }
  }

  return NextResponse.json({
    chunk: {
      id: row.chunkId,
      content: row.content,
      chunkIndex,
      page,
    },
    document: {
      id: row.docId,
      filename: row.filename,
      workspaceId: row.docWorkspaceId,
      workspaceName: row.workspaceName,
    },
    prev,
    next,
  });
}
