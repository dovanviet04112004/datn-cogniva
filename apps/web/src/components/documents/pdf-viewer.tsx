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
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Đọc hash ban đầu (ví dụ #page-3) để jump tới trang đúng
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const match = hash.match(/^#page-(\d+)$/);
    if (match) setCurrentPage(parseInt(match[1]!, 10));
  }, []);

  // Khi đổi currentPage → scroll smooth tới page đó
  useEffect(() => {
    const el = pageRefs.current.get(currentPage);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentPage]);

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

      {/* ── PDF area ─────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 overflow-y-auto bg-muted/30 px-4 py-4">
        <Document
          file={src}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
          error={
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
              Không tải được PDF. Có thể file đã bị xoá hoặc storage lỗi.
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
      </div>
    </div>
  );
}
