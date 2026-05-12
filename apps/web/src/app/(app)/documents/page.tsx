/**
 * Trang /documents — liệt kê tài liệu của user + dropzone upload.
 *
 * Server Component: fetch danh sách trực tiếp qua Drizzle (không qua API
 * route) cho SSR nhanh + type-safe. Khi upload xong, dropzone client gọi
 * router.refresh() để re-render server và lấy list mới nhất.
 */
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { count, desc, eq, sql } from 'drizzle-orm';

import { chunk, db, document } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/documents/status-badge';
import { UploadDropzone } from '@/components/documents/upload-dropzone';
import { formatRelativeTime } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * Format byte → KB/MB ngắn gọn cho UI.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/documents');

  // Subquery đếm chunk theo documentId — tránh N+1
  const chunkCount = db
    .select({ documentId: chunk.documentId, n: count(chunk.id).as('n') })
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

  return (
    <div className="container max-w-5xl space-y-8 py-8">
      {/* ── Header ──────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Upload PDF để Cogniva parse, chunk, embed và lưu vào knowledge base.
        </p>
      </div>

      {/* ── Dropzone ────────────────────────────────── */}
      <UploadDropzone />

      {/* ── List ────────────────────────────────────── */}
      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Chưa có tài liệu nào</CardTitle>
            <CardDescription>
              Upload PDF đầu tiên ở khung phía trên để bắt đầu xây kho kiến thức của bạn.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((doc) => {
            const isReady = doc.status === 'READY';
            // Khi PROCESSING/FAILED, vẫn cho click vào để xem trạng thái + chunks (nếu có)
            return (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="block rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Mở tài liệu ${doc.filename}`}
              >
                <Card className="cursor-pointer transition-colors hover:bg-muted/30 hover:border-primary/30">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="truncate text-sm font-medium">{doc.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(doc.size)}
                        {doc.pageCount ? ` · ${doc.pageCount} pages` : ''}
                        {doc.chunks > 0 ? ` · ${doc.chunks} chunks` : ''}
                        {' · '}
                        {formatRelativeTime(doc.createdAt)}
                        {!isReady && ' · click để xem trạng thái'}
                      </p>
                    </div>
                    <StatusBadge status={doc.status} />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
