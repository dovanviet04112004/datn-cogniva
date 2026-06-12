import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';

import { getServerSession } from '@/lib/auth-server';
import { apiServer, apiServerOrNull } from '@/lib/api-server';
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

type DocumentDetail = {
  id: string;
  filename: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  workspaceId: string;
};

type ChunkRow = {
  id: string;
  content: string;
  tokens: number;
  chunkIndex: number | null;
  page: number | null;
};

export default async function DocumentDetailPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  const { id } = await params;

  const doc = await apiServerOrNull<DocumentDetail>(`/api/documents/${id}`);
  if (!doc) notFound();

  const { chunks } = await apiServer<{ chunks: ChunkRow[] }>(`/api/documents/${id}/chunks`);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" asChild aria-label="Quay lại documents">
          <Link href="/documents">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <FileText className="text-muted-foreground h-4 w-4" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{doc.filename}</p>
        </div>
        <DocumentDetailActions workspaceId={doc.workspaceId} />
        <StatusBadge status={doc.status} />
      </div>

      <div className="grid h-[calc(100vh-7.5rem)] grid-cols-1 overflow-hidden lg:grid-cols-[2fr_1fr]">
        <div className="min-h-0 overflow-hidden border-r">
          {doc.status === 'READY' ? (
            <PdfViewer src={`/api/documents/${id}/file`} />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              {doc.status === 'PROCESSING'
                ? 'Đang xử lý — quay lại sau ít phút.'
                : 'Tài liệu chưa sẵn sàng để hiển thị.'}
            </div>
          )}
        </div>

        <div className="bg-muted/10 flex min-h-0 flex-col overflow-hidden">
          <div className="bg-background/60 flex shrink-0 items-center justify-between border-b px-4 py-2 backdrop-blur">
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
                  metadata: {
                    page: c.page ?? undefined,
                    chunkIndex: c.chunkIndex ?? undefined,
                  },
                }))}
              />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
