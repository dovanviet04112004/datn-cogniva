/**
 * DocPreviewPanel — NotebookLM-style MODAL OVERLAY hiển thị document.
 *
 * V8.7 (2026-05-20): pivot từ "right side panel / Main swap" → modal floating
 * overlay (giống NotebookLM source viewer). Lý do: user feedback muốn click
 * doc → modal chèn lên giao diện, X/minimize đóng quay lại sidebar.
 *
 * UX:
 *   - Auto-open khi `useDocPreview().citation` set (click [N] trong chat
 *     hoặc click doc trong SourcesPanel)
 *   - Modal floating ~90vw × 90vh (max-w-[1400px]), backdrop blur dim
 *   - Header: filename + meta + chunks toggle + minimize + X
 *   - Body: PDF + (optional) chunks side panel khi toggle
 *   - Close: X / minimize / click backdrop / Escape — đều gọi ctx.close()
 *   - Mount qua Radix DialogPortal → render ở body root, KHÔNG bị parent
 *     overflow-hidden cắt
 *
 * Fetch:
 *   - /api/chunks/[id] → chunk hiện tại + doc meta (chỉ khi có chunkId)
 *   - /api/documents/[id]/chunks → toàn bộ chunks list (cho panel toggle)
 */
'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import Link from 'next/link';
import {
  ExternalLink,
  FileText,
  List,
  Loader2,
  Minimize2,
  PanelRightClose,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import {
  PdfViewer,
  type PdfViewerHandle,
} from '@/components/documents/pdf-viewer';
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
  // V8.8: modal chỉ mở khi mode='modal'. mode='inline' → render bởi
  // SourcesPanel (inline preview), modal ẩn.
  const open = ctx?.citation != null && ctx.mode === 'modal';

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          // Click backdrop / Esc → nếu có inline host thì minimize, else close
          if (ctx?.supportInline) ctx.setMode('inline');
          else ctx?.close();
        }
      }}
    >
      <DialogPrimitive.Portal>
        {/* Backdrop dim NHẸ, KHÔNG blur */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-foreground/30',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        {/* Modal content — floating ~90vw × 90vh, max 1400px */}
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex h-[90vh] w-[90vw] max-w-[1400px] flex-col overflow-hidden',
            'rounded-2xl border border-divider bg-card shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Title cho a11y (Radix yêu cầu) — visually hidden */}
          <DialogPrimitive.Title className="sr-only">
            Xem tài liệu
          </DialogPrimitive.Title>
          <DocPreviewBody />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Inner body — tách ra để chỉ mount khi modal mở (early return cũng vẫn ổn,
 * nhưng tách giúp hooks không chạy khi citation = null).
 */
function DocPreviewBody() {
  const ctx = useDocPreview();
  /**
   * Chunks panel ẩn mặc định (NotebookLM clean reading). User toggle để xem.
   */
  const [chunksOpen, setChunksOpen] = React.useState(false);
  const [activeChunkId, setActiveChunkId] = React.useState<string | null>(null);

  const viewerRef = React.useRef<PdfViewerHandle>(null);
  const activeChunkLiRef = React.useRef<HTMLLIElement | null>(null);

  const chunkId = ctx?.citation?.chunkId ?? null;
  const docId = ctx?.citation?.documentId ?? null;

  // Chunk + doc info qua React Query (citation mode) — keepPreviousData giữ
  // doc cũ hiển thị mượt khi đổi citation thay vì nháy spinner.
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

  // Toàn bộ chunks của document (cho panel toggle).
  const {
    data: chunksData,
    isLoading: chunksLoading,
    error: chunksError,
  } = useQuery({
    queryKey: qk.documentChunks(docId ?? ''),
    queryFn: () =>
      apiGet<{ chunks: ChunkItem[] }>(`/api/documents/${docId}/chunks`).then(
        (d) => d.chunks ?? [],
      ),
    enabled: !!docId,
  });
  const chunks = chunksData ?? [];

  // Toast lỗi (bell không quan trọng nhưng doc viewer thì có) — non-silent.
  React.useEffect(() => {
    if (chunkError) toast.error('Load chunk lỗi: ' + (chunkError as Error).message);
  }, [chunkError]);
  React.useEffect(() => {
    if (chunksError) toast.error('Load chunks lỗi: ' + (chunksError as Error).message);
  }, [chunksError]);

  // Reset active chunk + đóng chunks panel khi đổi document
  React.useEffect(() => {
    setActiveChunkId(chunkId);
    setChunksOpen(false);
  }, [docId, chunkId]);

  // Auto-scroll list để chunk active vào view khi panel mở
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
      {/* Header — NotebookLM style: filename + meta + actions */}
      <header className="shrink-0 border-b px-4 py-2.5">
        <div className="flex items-start gap-2.5">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[14px] font-semibold tracking-tight"
              title={filename}
            >
              {filename}
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
          {/* Actions group */}
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
            {/* Minimize — quay về inline sidebar (nếu có host).
                Nếu không có host (chat detail standalone) → ẩn nút này, X
                vẫn đủ. */}
            {ctx.supportInline && (
              <button
                type="button"
                onClick={() => ctx.setMode('inline')}
                aria-label="Thu nhỏ"
                title="Thu nhỏ — quay lại sidebar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => ctx.close()}
              aria-label="Đóng"
              title="Đóng (Esc)"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Body — PDF + (optional) chunks side panel */}
      <div className="relative flex flex-1 overflow-hidden">
        <div className="min-w-0 flex-1">
          {loading && !data && isCitationMode ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <PdfViewer
              ref={viewerRef}
              src={pdfSrc}
              initialPage={page ?? 1}
            />
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
          <div className="absolute inset-0 z-10 bg-card md:hidden">
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

      {/* Footer compact — link "Mở workspace" nhỏ */}
      {wsId && (
        <footer className="shrink-0 border-t bg-muted/20 px-4 py-1.5">
          <Link
            href={`/workspaces/${wsId}?view=chat`}
            className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-primary"
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
    <div className="flex h-full flex-col overflow-hidden bg-muted/10">
      <div className="flex shrink-0 items-center justify-between border-b bg-background/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {chunks.length > 0 ? `${chunks.length} chunks` : 'Chunks'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng chunks"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {chunksLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : chunks.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            Chưa có chunk nào.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {chunks.map((c, i) => {
              const hasPage = c.page !== null && c.page > 0;
              const isActive = activeChunkId === c.id;
              return (
                <li
                  key={c.id}
                  ref={isActive ? activeChunkLiRef : undefined}
                >
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
                      'block w-full rounded-md border bg-card px-2.5 py-2 text-left text-[11.5px] transition-colors',
                      hasPage
                        ? 'cursor-pointer hover:border-primary/40 hover:bg-muted/40'
                        : 'cursor-default opacity-70',
                      isActive &&
                        'border-primary bg-primary/5 ring-1 ring-primary/40',
                    )}
                  >
                    <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">#{c.chunkIndex ?? i}</span>
                      <span>
                        {hasPage ? `trang ${c.page} · ` : ''}
                        {c.tokens ?? '?'} tok
                      </span>
                    </div>
                    <p className="line-clamp-4 leading-snug text-foreground/90">
                      {c.content}
                    </p>
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
