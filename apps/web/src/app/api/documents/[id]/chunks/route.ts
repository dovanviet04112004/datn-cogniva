/**
 * GET /api/documents/[id]/chunks — list toàn bộ chunks của document.
 *
 * V8.1 (2026-05-20): dùng cho DocPreviewPanel khi user click document trong
 * SourcesPanel (workspace V5) → cần hiện cả PDF + chunk list giống trang
 * `/documents/[id]` full nhưng inline trong panel.
 *
 * Sort theo `metadata.chunkIndex` ASC NULLS LAST (vị trí đọc trong document),
 * giống cách trang `/documents/[id]` đã làm — KHÔNG sort theo `chunk.id` vì
 * cuid2 random.
 *
 * Bảo mật: verify document.userId === session.user.id (chống IDOR), trả về
 * 403 nếu mismatch (consistent với /api/documents/[id]/file).
 *
 * Output:
 *   {
 *     chunks: Array<{
 *       id: string;
 *       content: string;
 *       tokens: number | null;
 *       chunkIndex: number | null;
 *       page: number | null;
 *     }>
 *   }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';

// GET read thuần (verify owner + scan chunks) → dùng `dbReplica` offload primary.
import { chunk, dbReplica, document } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership trước khi list chunks (chống IDOR)
  const [doc] = await dbReplica
    .select({ userId: document.userId })
    .from(document)
    .where(eq(document.id, id))
    .limit(1);
  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (doc.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await dbReplica
    .select({
      id: chunk.id,
      content: chunk.content,
      tokens: chunk.tokens,
      metadata: chunk.metadata,
    })
    .from(chunk)
    .where(eq(chunk.documentId, id))
    .orderBy(sql`(${chunk.metadata}->>'chunkIndex')::int ASC NULLS LAST`);

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

  return NextResponse.json({ chunks });
}
