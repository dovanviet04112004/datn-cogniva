/**
 * /documents/[id] — chi tiết tài liệu: PDF viewer (trái) + chunk list (phải).
 *
 * URL hash #page-N được PdfViewer đọc để scroll tới trang citation jump-to.
 */
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';

import { chunk, db, document } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatusBadge } from '@/components/documents/status-badge';
import { PdfViewer } from '@/components/documents/pdf-viewer';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function DocumentDetailPage({ params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const { id } = await params;

  const [doc] = await db
    .select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.userId, session.user.id)))
    .limit(1);
  if (!doc) notFound();

  const chunks = await db
    .select({
      id: chunk.id,
      content: chunk.content,
      tokens: chunk.tokens,
      metadata: chunk.metadata,
    })
    .from(chunk)
    .where(eq(chunk.documentId, id))
    .orderBy(asc(chunk.id));

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ───────────────────────────────── */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" asChild aria-label="Quay lại documents">
          <Link href="/documents">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <FileText className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{doc.filename}</p>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      {/* ── Body: PDF + chunks ─────────────────── */}
      <div className="grid h-[calc(100vh-7.5rem)] grid-cols-1 lg:grid-cols-[2fr_1fr]">
        {/* PDF viewer */}
        <div className="border-r">
          {doc.status === 'READY' ? (
            <PdfViewer src={`/api/documents/${id}/file`} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {doc.status === 'PROCESSING'
                ? 'Đang xử lý — quay lại sau ít phút.'
                : 'Tài liệu chưa sẵn sàng để hiển thị.'}
            </div>
          )}
        </div>

        {/* Chunks panel */}
        <ScrollArea className="bg-muted/10">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Chunks ({chunks.length})</h2>
              <Badge variant="outline" className="text-[10px]">
                vector(1024) HNSW
              </Badge>
            </div>
            {chunks.length === 0 ? (
              <p className="text-xs text-muted-foreground">Chưa có chunk nào.</p>
            ) : (
              chunks.map((c, i) => {
                const meta = (c.metadata ?? {}) as { page?: number; chunkIndex?: number };
                return (
                  <Card key={c.id} className="border-muted">
                    <CardContent className="space-y-1 py-3 text-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="font-mono">#{meta.chunkIndex ?? i}</span>
                        <span>
                          {meta.page ? `trang ${meta.page} · ` : ''}
                          {c.tokens} tok
                        </span>
                      </div>
                      <p className="line-clamp-4 text-foreground/90">{c.content}</p>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
