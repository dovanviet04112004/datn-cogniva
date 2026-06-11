'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import Link from 'next/link';
import { ExternalLink, FileText, List, Loader2, Minimize2, PanelRightClose, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { PdfViewer, type PdfViewerHandle } from '@/components/documents/pdf-viewer';
import { cn } from '@/lib/utils';
import { useDocPreview } from './doc-preview-context';

type ChunkDetail = {
  chunk: {
    id: string;
    content: string;
    chunkIndex: number | null;
    page: number | null;
  };
  document: {
    id: string;
    filename: string;
    workspaceId: string | null;
    workspaceName: string | null;
  };
};

type ChunkItem = {
  id: string;
  content: string;
  tokens: number | null;
  chunkIndex: number | null;
  page: number | null;
};

export function DocPreviewPanel() {
  const ctx = useDocPreview();
  const open = ctx?.citation != null && ctx.mode === 'modal';

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (ctx?.supportInline) ctx.setMode('inline');
          else ctx?.close();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'bg-foreground/30 fixed inset-0 z-50',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex h-[90vh] w-[90vw] max-w-[1400px] flex-col overflow-hidden',
            'border-divider bg-card rounded-2xl border shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">Xem tài liệu</DialogPrimitive.Title>
          <DocPreviewBody />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DocPreviewBody() {
  const ctx = useDocPreview();
  const [chunksOpen, setChunksOpen] = React.useState(false);
  const [activeChunkId, setActiveChunkId] = React.useState<string | null>(null);

  const viewerRef = React.useRef<PdfViewerHandle>(null);
  const activeChunkLiRef = React.useRef<HTMLLIElement | null>(null);

  const chunkId = ctx?.citation?.chunkId ?? null;
  const docId = ctx?.citation?.documentId ?? null;

  const {
    data: chunkData,
    isLoading: loading,
    error: chunkError,
  } = useQuery({
    queryKey: qk.chunk(chunkId ?? ''),
    queryFn: () => apiGet<ChunkDetail>(`/api/chunks/${chunkId}`),
    enabled: !!chunkId,
    placeholderData: keepPreviousData,
  });
  const data = chunkData ?? null;

  const {
    data: chunksData,
    isLoading: chunksLoading,
    error: chunksError,
  } = useQuery({
    queryKey: qk.documentChunks(docId ?? ''),
    queryFn: () =>
      apiGet<{ chunks: ChunkItem[] }>(`/api/documents/${docId}/chunks`).then((d) => d.chunks ?? []),
    enabled: !!docId,
  });
  const chunks = chunksData ?? [];

  React.useEffect(() => {
    if (chunkError) toast.error('Load chunk lỗi: ' + (chunkError as Error).message);
  }, [chunkError]);
  React.useEffect(() => {
    if (chunksError) toast.error('Load chunks lỗi: ' + (chunksError as Error).message);
  }, [chunksError]);

  React.useEffect(() => {
    setActiveChunkId(chunkId);
    setChunksOpen(false);
  }, [docId, chunkId]);

  React.useEffect(() => {
    if (!activeChunkId || !chunksOpen) return;
    const id = requestAnimationFrame(() => {
      activeChunkLiRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
    return () => cancelAnimationFrame(id);
  }, [activeChunkId, chunksOpen, chunks.length]);

  if (!ctx?.citation) return null;

  const baseCitation = ctx.citation;
  const resolvedDocId = data?.document.id ?? baseCitation.documentId;
  const filename = data?.document.filename ?? baseCitation.filename;
  const page = data?.chunk.page ?? baseCitation.page;
  const wsId = data?.document.workspaceId;
  const wsName = data?.document.workspaceName;
  const isCitationMode = baseCitation.n > 0;

  const pdfSrc = `/api/documents/${resolvedDocId}/file`;

  const jumpToPage = (c: ChunkItem) => {
    setActiveChunkId(c.id);
    if (c.page) viewerRef.current?.goToPage(c.page);
  };

  return (
    <>
      <header className="shrink-0 border-b px-4 py-2.5">
        <div className="flex items-start gap-2.5">
          <FileText className="text-primary mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold tracking-tight" title={filename}>
              {filename}
            </p>
            <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              {isCitationMode && <span>Nguồn #{baseCitation.n}</span>}
              {isCitationMode && page !== null && <span>·</span>}
              {page !== null && <span>Trang {page}</span>}
              {chunks.length > 0 && (
                <>
                  {(isCitationMode || page !== null) && <span>·</span>}
                  <span>Dựa trên {chunks.length} chunk</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setChunksOpen((o) => !o)}
              aria-label={chunksOpen ? 'Ẩn chunks' : 'Hiện chunks'}
              title={chunksOpen ? 'Ẩn chunks' : `Hiện ${chunks.length} chunks`}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors',
                chunksOpen
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <List className="h-3.5 w-3.5" />
              {chunks.length > 0 && <span>{chunks.length}</span>}
            </button>
            {ctx.supportInline && (
              <button
                type="button"
                onClick={() => ctx.setMode('inline')}
                aria-label="Thu nhỏ"
                title="Thu nhỏ — quay lại sidebar"
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => ctx.close()}
              aria-label="Đóng"
              title="Đóng (Esc)"
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        <div className="min-w-0 flex-1">
          {loading && !data && isCitationMode ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : (
            <PdfViewer ref={viewerRef} src={pdfSrc} initialPage={page ?? 1} />
          )}
        </div>

        {chunksOpen && (
          <div className="hidden w-[320px] shrink-0 border-l md:flex md:flex-col">
            <ChunksList
              chunks={chunks}
              chunksLoading={chunksLoading}
              activeChunkId={activeChunkId}
              activeChunkLiRef={activeChunkLiRef}
              onJump={jumpToPage}
              onClose={() => setChunksOpen(false)}
            />
          </div>
        )}
        {chunksOpen && (
          <div className="bg-card absolute inset-0 z-10 md:hidden">
            <ChunksList
              chunks={chunks}
              chunksLoading={chunksLoading}
              activeChunkId={activeChunkId}
              activeChunkLiRef={activeChunkLiRef}
              onJump={jumpToPage}
              onClose={() => setChunksOpen(false)}
            />
          </div>
        )}
      </div>

      {wsId && (
        <footer className="bg-muted/20 shrink-0 border-t px-4 py-1.5">
          <Link
            href={`/workspaces/${wsId}?view=chat`}
            className="text-muted-foreground hover:text-primary inline-flex items-center gap-1 text-[10.5px]"
            title="Mở workspace chứa document này"
          >
            <ExternalLink className="h-2.5 w-2.5" />
            Mở workspace {wsName ? `"${wsName}"` : ''}
          </Link>
        </footer>
      )}
    </>
  );
}

function ChunksList({
  chunks,
  chunksLoading,
  activeChunkId,
  activeChunkLiRef,
  onJump,
  onClose,
}: {
  chunks: ChunkItem[];
  chunksLoading: boolean;
  activeChunkId: string | null;
  activeChunkLiRef: React.RefObject<HTMLLIElement | null>;
  onJump: (c: ChunkItem) => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-muted/10 flex h-full flex-col overflow-hidden">
      <div className="bg-background/60 flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
          {chunks.length > 0 ? `${chunks.length} chunks` : 'Chunks'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng chunks"
          className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-6 w-6 items-center justify-center rounded-md"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {chunksLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          </div>
        ) : chunks.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-center text-[11px]">
            Chưa có chunk nào.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {chunks.map((c, i) => {
              const hasPage = c.page !== null && c.page > 0;
              const isActive = activeChunkId === c.id;
              return (
                <li key={c.id} ref={isActive ? activeChunkLiRef : undefined}>
                  <button
                    type="button"
                    onClick={() => onJump(c)}
                    disabled={!hasPage}
                    aria-label={
                      hasPage
                        ? `Mở chunk #${c.chunkIndex ?? i} tại trang ${c.page}`
                        : `Chunk #${c.chunkIndex ?? i} (không có trang)`
                    }
                    className={cn(
                      'bg-card block w-full rounded-md border px-2.5 py-2 text-left text-[11.5px] transition-colors',
                      hasPage
                        ? 'hover:border-primary/40 hover:bg-muted/40 cursor-pointer'
                        : 'cursor-default opacity-70',
                      isActive && 'border-primary bg-primary/5 ring-primary/40 ring-1',
                    )}
                  >
                    <div className="text-muted-foreground mb-0.5 flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-mono">#{c.chunkIndex ?? i}</span>
                      <span>
                        {hasPage ? `trang ${c.page} · ` : ''}
                        {c.tokens ?? '?'} tok
                      </span>
                    </div>
                    <p className="text-foreground/90 line-clamp-4 leading-snug">{c.content}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
