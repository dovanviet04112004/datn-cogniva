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

import { chunk, dbReplica, document } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  // Cache-aside per-user: list document + chunkCount đổi chậm (chỉ khi
  // upload/xoá/move — đã wire onDocumentChanged ở các route ghi). TTL 60s
  // làm lưới an toàn cuối nếu sót invalidation. Đọc thuần → dùng dbReplica.
  // KHÔNG bọc try/catch — cached() đã fail-open sẵn.
  //
  // createdAt để NGUYÊN string serialize: consumer duy nhất là NextResponse.json
  // (mobile/web list + dialog chỉ render), không có date-math → không cần re-hydrate Date.
  const documents = await cached(ck.documents(userId), 60, async () => {
    // Subquery đếm chunk theo documentId — tránh N+1 query
    const chunkCount = dbReplica
      .select({
        documentId: chunk.documentId,
        n: count(chunk.id).as('n'),
      })
      .from(chunk)
      .groupBy(chunk.documentId)
      .as('chunk_count');

    return dbReplica
      .select({
        id: document.id,
        filename: document.filename,
        mimeType: document.mimeType,
        size: document.size,
        status: document.status,
        // workspaceId expose để frontend filter docs theo workspace
        // (chat panel pin tài liệu) mà không cần 1 endpoint riêng.
        workspaceId: document.workspaceId,
        createdAt: document.createdAt,
        pageCount: sql<number | null>`(${document.metadata}->>'pageCount')::int`,
        chunks: sql<number>`coalesce(${chunkCount.n}, 0)::int`,
      })
      .from(document)
      .leftJoin(chunkCount, eq(document.id, chunkCount.documentId))
      .where(eq(document.userId, userId))
      .orderBy(desc(document.createdAt))
      .limit(100);
  });

  return NextResponse.json({ documents });
}
