/**
 * PdfViewer — render PDF với react-pdf (PDF.js wrapper).
 *
 * Tính năng:
 *   - Render từng trang trên 1 column scroll dọc
 *   - Hỗ trợ navigation qua URL hash `#page-N` — scroll tới trang đó
 *     (dùng cho citation jump-to-page từ chat)
 *   - Highlight trang hiện tại bằng border primary mảnh
 *   - Zoom controls (+/− buttons) và page indicator
 *
 * Worker setup:
 *   - PDF.js cần worker file để parse PDF off-thread
 *   - Dùng `pdfjs-dist` đã include trong bundle, copy worker từ
 *     node_modules sang /public/pdf.worker.min.mjs khi build
 *   - Phase 2 v1: load worker từ CDN (đơn giản nhất). Production sẽ
 *     self-host vì chính sách cache + CSP
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Worker từ unpkg CDN — match version với pdfjs-dist trong package.json
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

/**
 * PDF.js options — `withCredentials: true` để fetch PDF bằng cookie session
 * (endpoint /api/documents/[id]/file verify session.userId). Module-level
 * const để tránh React re-render trigger reload PDF (mỗi object literal mới
 * sẽ trigger react-pdf reload — Documentation cảnh báo).
 */
const pdfOptions = { withCredentials: true } as const;

type Props = {
  /** URL stream file (ví dụ /api/documents/<id>/file). */
  src: string;
  /** Trang ban đầu cần scroll tới (1-indexed). */
  initialPage?: number;
};

export function PdfViewer({ src, initialPage }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1);
  const [scale, setScale] = useState(1.1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  /**
   * Fetch PDF trên main thread (có cookie tự động cho same-origin) → blob URL.
   *
   * Trước đây pass `src` URL trực tiếp vào `<Document file={src}>` → react-pdf
   * gửi xuống pdfjs worker → worker tự fetch → KHÔNG có cookie → endpoint trả
   * 401. `options.withCredentials` chỉ hoạt động với XHR cũ, pdfjs v5+ dùng
   * fetch API mặc định `credentials: 'same-origin'` thay vì 'include' khi
   * worker call.
   *
   * Bypass: main-thread fetch, blob URL pass vào worker. Worker chỉ parse.
   */
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    setPdfBlobUrl(null);
    setFetchError(null);

    fetch(src, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setPdfBlobUrl(createdUrl);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error('[pdf-viewer] fetch fail:', err.message);
        setFetchError(err.message);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src]);

  // Đọc hash (ví dụ #page-3) để jump tới trang đúng.
  // - Lần đầu mount: parse hash hiện tại.
  // - Sau mount: listen `hashchange` để chunk list (panel phải) hoặc citation
  //   trong chat có thể trigger jump qua window.location.hash mà PdfViewer phản ứng.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const readHash = () => {
      const match = window.location.hash.match(/^#page-(\d+)$/);
      if (match) setCurrentPage(parseInt(match[1]!, 10));
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  // Sync `initialPage` prop → `currentPage` state khi prop đổi (không phải
  // remount). Use case: user click citation [1] sang [3] cùng document →
  // DocPreviewPanel re-render với citation.page mới, prop initialPage đổi,
  // PdfViewer KHÔNG remount (vì key={documentId} không đổi). useState(init)
  // chỉ chạy lần mount đầu → cần useEffect để pick up prop change.
  useEffect(() => {
    if (initialPage !== undefined) setCurrentPage(initialPage);
  }, [initialPage]);

  // Khi đổi currentPage HOẶC pages mới render → scroll smooth tới page đó.
  // Dependency `numPages` quan trọng: lần đầu render, pages chưa mount khi
  // currentPage = initialPage. Effect chạy lúc currentPage set xong nhưng
  // pageRefs.current.get(currentPage) = undefined → no-op. Khi numPages
  // resolve (pdf load xong) → effect chạy lại → ref có → scroll.
  useEffect(() => {
    const el = pageRefs.current.get(currentPage);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentPage, numPages]);

  return (
    <div className="flex h-full flex-col">
      {/* ── Toolbar ──────────────────────────────────── */}
      <div className="flex items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            aria-label="Trang trước"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 text-xs tabular-nums text-muted-foreground">
            {numPages ? `${currentPage} / ${numPages}` : '… / …'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={!numPages || currentPage >= numPages}
            onClick={() => setCurrentPage((p) => (numPages ? Math.min(numPages, p + 1) : p))}
            aria-label="Trang sau"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
            aria-label="Thu nhỏ"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="px-2 text-xs tabular-nums text-muted-foreground">
            {(scale * 100).toFixed(0)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}
            aria-label="Phóng to"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── PDF area ───────────────────────────────────
          overscroll-contain: khi scroll PDF đến cuối, KHÔNG chain ra ngoài
          (tránh main page scroll theo) — hợp với chunks panel độc lập. */}
      <div ref={containerRef} className="flex-1 overflow-y-auto overscroll-contain bg-muted/30 px-4 py-4">
        {fetchError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
            Không tải được PDF: {fetchError}
          </div>
        ) : !pdfBlobUrl ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
        <Document
          // pdfBlobUrl = blob: URL từ main-thread fetch — pdfjs worker
          // chỉ parse, không network fetch nữa
          file={pdfBlobUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={(err) => {
            // Log chi tiết để debug — error UI ngắn nhưng console giữ full
            console.error('[pdf-viewer] parse fail:', err);
          }}
          loading={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
          error={
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
              PDF parse lỗi — file có thể corrupt.
            </div>
          }
          className="flex flex-col items-center gap-4"
        >
          {numPages !== null &&
            Array.from({ length: numPages }, (_, i) => {
              const pageNumber = i + 1;
              const isCurrent = pageNumber === currentPage;
              return (
                <div
                  key={pageNumber}
                  ref={(el) => {
                    if (el) pageRefs.current.set(pageNumber, el);
                  }}
                  id={`page-${pageNumber}`}
                  className={cn(
                    'rounded-md bg-background shadow-sm transition-shadow',
                    isCurrent && 'ring-2 ring-primary',
                  )}
                >
                  <Page
                    pageNumber={pageNumber}
                    scale={scale}
                    renderAnnotationLayer
                    renderTextLayer
                  />
                </div>
              );
            })}
        </Document>
        )}
      </div>
    </div>
  );
}
