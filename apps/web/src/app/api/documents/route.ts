/**
 * GET /api/documents — liệt kê tài liệu của user hiện tại, kèm số chunk
 * đã ingest. Dùng cho trang /documents.
 *
 * Trả mảng theo thứ tự mới nhất trước. Limit cứng 100 ở Phase 1 — chưa
 * cần phân trang. Khi user vượt 100 doc sẽ thêm cursor pagination sau.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { count, desc, eq, sql } from 'drizzle-orm';

import { chunk, db, document } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Subquery đếm chunk theo documentId — tránh N+1 query
  const chunkCount = db
    .select({
      documentId: chunk.documentId,
      n: count(chunk.id).as('n'),
    })
    .from(chunk)
    .groupBy(chunk.documentId)
    .as('chunk_count');

  const rows = await db
    .select({
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      size: document.size,
      status: document.status,
      createdAt: document.createdAt,
      pageCount: sql<number | null>`(${document.metadata}->>'pageCount')::int`,
      chunks: sql<number>`coalesce(${chunkCount.n}, 0)::int`,
    })
    .from(document)
    .leftJoin(chunkCount, eq(document.id, chunkCount.documentId))
    .where(eq(document.userId, session.user.id))
    .orderBy(desc(document.createdAt))
    .limit(100);

  return NextResponse.json({ documents: rows });
}
