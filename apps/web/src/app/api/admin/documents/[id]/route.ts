/**
 * GET /api/admin/documents/[id] — chi tiết 1 document + chunks + owner + stats.
 *
 * Response:
 *   document: { ...metadata, userName, userEmail, workspaceName }
 *   chunks:   { id, content (preview 200 chars), tokens, position }[]  (first 20)
 *   stats:    { chunkCount, tokenTotal }
 *
 * DELETE /api/admin/documents/[id] — soft delete: chỉ xoá DB row (FK cascade
 * sẽ tự xoá chunks). KHÔNG xoá file trên R2 — admin có thể restore tạm thời
 * bằng cách re-upload với cùng storage key. Hard delete file là việc của
 * cleanup job riêng.
 *
 * Body DELETE: { reason: string (10..500) }
 * Mọi mutation đi qua withAudit().
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { chunk, db, document, user, workspace } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;

  const [row] = await db
    .select({
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      size: document.size,
      status: document.status,
      storageKey: document.storageKey,
      metadata: document.metadata,
      createdAt: document.createdAt,
      userId: document.userId,
      userName: user.name,
      userEmail: user.email,
      workspaceId: document.workspaceId,
      workspaceName: workspace.name,
    })
    .from(document)
    .leftJoin(user, eq(user.id, document.userId))
    .leftJoin(workspace, eq(workspace.id, document.workspaceId))
    .where(eq(document.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  // Lấy 20 chunks đầu (preview-only) + stats tổng
  const [[stats], chunks] = await Promise.all([
    db
      .select({
        n: count(chunk.id),
        tokenSum: sql<number>`COALESCE(SUM(${chunk.tokens}), 0)::int`,
      })
      .from(chunk)
      .where(eq(chunk.documentId, id)),
    db
      .select({
        id: chunk.id,
        content: chunk.content,
        tokens: chunk.tokens,
        metadata: chunk.metadata,
      })
      .from(chunk)
      .where(eq(chunk.documentId, id))
      .orderBy(desc(chunk.tokens))
      .limit(20),
  ]);

  return NextResponse.json({
    document: {
      ...row,
      createdAt: row.createdAt.toISOString(),
    },
    chunks: chunks.map((c) => ({
      id: c.id,
      preview: c.content.slice(0, 240),
      tokens: c.tokens,
      metadata: c.metadata,
    })),
    stats: {
      chunkCount: stats?.n ?? 0,
      tokenTotal: stats?.tokenSum ?? 0,
    },
  });
}

const DELETE_SCHEMA = z.object({
  reason: z.string().trim().min(10).max(500),
});

export async function DELETE(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = DELETE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'document.delete',
    { type: 'document', id },
    async () => {
      const [before] = await db
        .select({
          id: document.id,
          filename: document.filename,
          userId: document.userId,
        })
        .from(document)
        .where(eq(document.id, id))
        .limit(1);
      if (!before) throw new Error('Document not found');

      // FK cascade từ document → chunk → chunkConcept tự lo
      await db.delete(document).where(eq(document.id, id));

      return { before, after: null, reason, result: { ok: true } };
    },
  );

  return NextResponse.json(result);
}
