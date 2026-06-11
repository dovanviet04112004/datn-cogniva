/**
 * /documents/[id] — chi tiết tài liệu: PDF viewer (trái) + chunk list (phải).
 *
 * URL hash #page-N được PdfViewer đọc để scroll tới trang citation jump-to.
 */
import { notFound, redirect } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';

import { chunk, db, document } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatusBadge } from '@/components/documents/status-badge';
import { PdfViewer } from '@/components/documents/pdf-viewer';
import { ChunkList } from '@/components/documents/chunk-list';
import { DocumentDetailActions } from '@/components/documents/document-detail-actions';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function DocumentDetailPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  const { id } = await params;

  const [doc] = await db
    .select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.userId, session.user.id)))
    .limit(1);
  if (!doc) notFound();

  // Sort theo metadata.chunkIndex (0-based vị trí đọc trong document).
  // KHÔNG sort theo chunk.id vì cuid2 random, không phản ánh thứ tự document.
  // Fallback NULLS LAST → chunk thiếu chunkIndex (legacy nếu có) xuống cuối.
  const chunks = await db
    .select({
      id: chunk.id,
      content: chunk.content,
      tokens: chunk.tokens,
      metadata: chunk.metadata,
    })
    .from(chunk)
    .where(eq(chunk.documentId, id))
    .orderBy(sql`(${chunk.metadata}->>'chunkIndex')::int ASC NULLS LAST`);

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
        <DocumentDetailActions workspaceId={doc.workspaceId} />
        <StatusBadge status={doc.status} />
      </div>

      {/* ── Body: PDF + chunks ────────────────────────
          Layout 2 cột cô lập scroll:
          - Grid container: `overflow-hidden` để không kéo main scroll.
          - Mỗi grid cell: `min-h-0 overflow-hidden` để con flex/scroll trong nó
            không stretch grid row vượt height của container.
          - PDF cột: scroll bên trong PdfViewer's overflow-y-auto.
          - Chunks cột: header sticky + ScrollArea h-full cô lập scroll. */}
      <div className="grid h-[calc(100vh-7.5rem)] grid-cols-1 overflow-hidden lg:grid-cols-[2fr_1fr]">
        {/* PDF viewer */}
        <div className="min-h-0 overflow-hidden border-r">
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

        {/* Chunks panel — header sticky, list scroll độc lập với PDF */}
        <div className="flex min-h-0 flex-col overflow-hidden bg-muted/10">
          <div className="flex shrink-0 items-center justify-between border-b bg-background/60 px-4 py-2 backdrop-blur">
            <h2 className="text-sm font-semibold">Chunks ({chunks.length})</h2>
            <Badge variant="outline" className="text-[10px]">
              vector(1024) HNSW
            </Badge>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4">
              <ChunkList
                chunks={chunks.map((c) => ({
                  id: c.id,
                  content: c.content,
                  tokens: c.tokens,
                  metadata: c.metadata as { page?: number; chunkIndex?: number } | null,
                }))}
              />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
