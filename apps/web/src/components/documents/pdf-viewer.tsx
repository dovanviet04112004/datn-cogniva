/**
 * PdfViewer — render PDF với react-pdf (PDF.js wrapper) — production-grade UI.
 *
 * Tính năng:
 *   - Render từng trang trong 1 column scroll dọc
 *   - Auto fit-to-width — đo container, scale page khớp với width khả dụng
 *     (toggle qua nút "Fit"). User vẫn override bằng +/-.
 *   - Page input — click số trang → input nhập jump tới trang đó (Enter để đi)
 *   - Hash navigation `#page-N` → scroll tới trang (citation jump)
 *   - Highlight trang hiện tại bằng ring primary
 *   - Scroll spy: cập nhật `currentPage` khi user scroll qua trang khác
 *
 * Worker: load từ unpkg CDN, version-pinned theo pdfjs-dist.
 */
'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minus, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Tắt warning level — chỉ giữ ERRORS. TextLayer task cancelled là behavior
// bình thường khi user scroll/zoom nhanh (page re-render hủy task cũ);
// pdfjs internal catch nhưng vẫn console.warn → noise. Set ERRORS giữ lỗi
// thật, ẩn cancellation noise.
// Ref: https://github.com/mozilla/pdf.js/issues/14305
if (typeof pdfjs.GlobalWorkerOptions !== 'undefined') {
  const pdfjsAny = pdfjs as unknown as {
    VerbosityLevel?: { ERRORS: number };
    setVerbosityLevel?: (level: number) => void;
  };
  if (pdfjsAny.VerbosityLevel && pdfjsAny.setVerbosityLevel) {
    pdfjsAny.setVerbosityLevel(pdfjsAny.VerbosityLevel.ERRORS);
  }
}

/**
 * Filter target trên console: react-pdf v9 vẫn `console.error/warn` trực tiếp
 * AbortException khi text-layer task bị cancel (page unmount giữa chừng).
 * `setVerbosityLevel(ERRORS)` ở trên chặn pdfjs internal, nhưng react-pdf
 * wrapper bypass. Next dev overlay capture console.error → show "Warning:"
 * dù không phải lỗi thật.
 *
 * Patch console 1 lần (idempotent flag) để filter các message AbortException
 * / "TextLayer task cancelled". Mọi error khác đi qua bình thường.
 *
 * Scope: chỉ chạy 1 lần ở client. Không monkey-patch nếu đã patch (HMR safe).
 */
declare global {
  // eslint-disable-next-line no-var
  var __cognivaPdfConsolePatched: boolean | undefined;
}
if (typeof window !== 'undefined' && !globalThis.__cognivaPdfConsolePatched) {
  globalThis.__cognivaPdfConsolePatched = true;
  const isPdfAbortNoise = (args: unknown[]): boolean => {
    for (const a of args) {
      const s = typeof a === 'string' ? a : (a as { message?: string })?.message;
      if (
        typeof s === 'string' &&
        (/AbortException/i.test(s) ||
          /TextLayer task cancelled/i.test(s) ||
          /Rendering cancelled/i.test(s))
      ) {
        return true;
      }
    }
    return false;
  };
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    if (isPdfAbortNoise(args)) return;
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (isPdfAbortNoise(args)) return;
    origWarn(...args);
  };
}

const pdfOptions = { withCredentials: true } as const;

/**
 * Swallow `AbortException` từ react-pdf khi page bị unmount/cancel mid-render
 * (scroll nhanh, zoom đổi scale liên tục). Đây là behavior bình thường:
 *   - Page A đang render text layer → user scroll → page A unmount
 *   - pdf.js throw AbortException để dừng task → react-pdf bubble lên handler
 * Nếu không catch, lỗi nổi lên console / Error Overlay của Next dev.
 *
 * Re-throw mọi error khác để KHÔNG mask bug thật (corrupted PDF, network…).
 */
function swallowAbortError(err: Error): void {
  if (err?.name === 'AbortException' || /AbortException/i.test(err?.message ?? '')) {
    return;
  }
  console.error('[pdf-viewer]', err);
}

type Props = {
  /** URL stream file (ví dụ /api/documents/<id>/file). */
  src: string;
  /** Trang ban đầu cần scroll tới (1-indexed). */
  initialPage?: number;
  /**
   * V8.10: chế độ toolbar gọn cho sidebar inline preview (~320px).
   * Ẩn nhóm zoom (-/+/fit) — chỉ giữ page nav. Default false (full toolbar).
   */
  compact?: boolean;
};

/**
 * Imperative handle để parent (vd DocPreviewPanel) gọi `goToPage(n)` mà
 * không phải thay đổi prop `initialPage` (prop ko trigger re-scroll khi
 * value trùng).
 */
export type PdfViewerHandle = {
  goToPage: (n: number) => void;
};

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { src, initialPage, compact = false },
  ref,
) {
  const [numPages, setNumPages] = useState<number | null>(null);
  /**
   * Tách 2 state để FIX feedback loop auto-scroll:
   *   - `targetPage`: user action (nav button, page input, hash, initialPage)
   *                   → trigger scroll smooth tới page đó.
   *   - `visiblePage`: scroll spy update khi user cuộn — KHÔNG trigger scroll
   *                    (avoid loop: scroll → spy set state → effect scroll → …).
   * Toolbar + highlight ring đều dùng `visiblePage` (page user đang nhìn thấy).
   */
  const [targetPage, setTargetPage] = useState(initialPage ?? 1);
  const [visiblePage, setVisiblePage] = useState(initialPage ?? 1);
  /** Scale tỉ lệ render PDF. `null` = auto fit-to-width (computed). */
  const [manualScale, setManualScale] = useState<number | null>(null);
  /** Fit-to-width: scale tính theo container width sau khi đo. */
  const [fitScale, setFitScale] = useState(1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  /** Input state cho page jump — tách khỏi currentPage để cho phép gõ tự do. */
  const [pageInputEditing, setPageInputEditing] = useState(false);
  const [pageInputValue, setPageInputValue] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  /** Page width gốc của PDF (lấy từ page đầu) — để tính fitScale. */
  const naturalPageWidth = useRef<number | null>(null);

  // Final scale: manual override hoặc fit
  const scale = manualScale ?? fitScale;

  /**
   * Fetch PDF main-thread → blob (bypass pdfjs worker credentials issue), CACHE
   * qua React Query theo `src`. File BẤT BIẾN → staleTime Infinity + gcTime 30'
   * → mở lại doc/citation cũ KHÔNG tải lại (lấy blob từ cache in-memory). KHÔNG
   * persist xuống IndexedDB (loại 'doc-file' ở query-provider).
   */
  const { data: pdfBlob, error: pdfError } = useQuery({
    queryKey: ['doc-file', src],
    queryFn: async () => {
      const r = await fetch(src, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    },
    enabled: !!src,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
  });
  const fetchError = pdfError ? (pdfError as Error).message : null;

  // Tạo objectURL từ blob (cached) cho react-pdf; revoke khi blob đổi / unmount.
  useEffect(() => {
    if (!pdfBlob) {
      setPdfBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(pdfBlob);
    setPdfBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfBlob]);

  /**
   * Compute fit-to-width scale dựa vào container width + natural page width.
   * Re-run khi container resize (ResizeObserver) hoặc PDF load xong.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const compute = () => {
      const cw = container.clientWidth;
      const pw = naturalPageWidth.current;
      if (!pw) return;
      // -32px padding (px-4 = 16px x 2) để page không sát mép
      const available = Math.max(200, cw - 32);
      setFitScale(Math.min(2.5, Math.max(0.4, available / pw)));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [pdfBlobUrl, numPages]);

  // Hash navigation #page-N → set TARGET (user intent, không phải scroll spy)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const readHash = () => {
      const match = window.location.hash.match(/^#page-(\d+)$/);
      if (match) setTargetPage(parseInt(match[1]!, 10));
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  // Sync initialPage prop → targetPage khi citation đổi (cùng doc)
  useEffect(() => {
    if (initialPage !== undefined) setTargetPage(initialPage);
  }, [initialPage]);

  /**
   * Scroll smooth tới targetPage. CHỈ watch targetPage — KHÔNG watch
   * visiblePage để tránh feedback loop với scroll spy.
   */
  useEffect(() => {
    const el = pageRefs.current.get(targetPage);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Sync visiblePage ngay để toolbar hiển thị đúng — sau đó scroll spy
      // sẽ tự confirm khi scroll thật sự dừng ở page này.
      setVisiblePage(targetPage);
    }
  }, [targetPage, numPages]);

  /**
   * Scroll spy: khi user scroll qua trang khác, cập nhật visiblePage
   * (NOT targetPage) → không trigger lại auto-scroll effect.
   * IntersectionObserver — page nào > 50% trong viewport → set visible.
   */
  useEffect(() => {
    if (!numPages || !containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (top) {
          const pageNum = Number((top.target as HTMLElement).dataset.pageNumber);
          if (!Number.isNaN(pageNum)) setVisiblePage(pageNum);
        }
      },
      {
        root: containerRef.current,
        threshold: [0.5],
      },
    );
    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [numPages]);

  /** Page user đang nhìn thấy — dùng cho toolbar + highlight ring. */
  const currentPage = visiblePage;

  const goToPage = (n: number) => {
    if (!numPages) return;
    setTargetPage(Math.max(1, Math.min(numPages, n)));
  };

  // Expose imperative handle: cho parent gọi goToPage trực tiếp.
  useImperativeHandle(
    ref,
    () => ({
      goToPage: (n: number) => {
        // Nếu chưa biết numPages (PDF chưa load xong), vẫn set targetPage để
        // sau khi load xong useEffect [targetPage, numPages] sẽ scroll.
        setTargetPage(Math.max(1, numPages ? Math.min(numPages, n) : n));
      },
    }),
    [numPages],
  );

  const onPageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(pageInputValue, 10);
    if (!Number.isNaN(n)) goToPage(n);
    setPageInputEditing(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Toolbar ──────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-b bg-background/80 px-3 py-1.5 backdrop-blur">
        {/* Page nav */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
            aria-label="Trang trước"
            className="h-7 w-7"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          {pageInputEditing ? (
            <form onSubmit={onPageInputSubmit} className="flex items-center gap-1 text-xs">
              <input
                type="number"
                value={pageInputValue}
                onChange={(e) => setPageInputValue(e.target.value)}
                onBlur={onPageInputSubmit}
                autoFocus
                min={1}
                max={numPages ?? 999}
                className="w-12 rounded border bg-background px-1.5 py-0.5 text-center tabular-nums outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">/ {numPages ?? '…'}</span>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPageInputValue(String(currentPage));
                setPageInputEditing(true);
              }}
              className="rounded px-2 py-1 text-xs tabular-nums hover:bg-muted"
              title="Click để nhập trang"
            >
              {numPages ? (
                <>
                  <span className="font-medium text-foreground">{currentPage}</span>
                  <span className="text-muted-foreground"> / {numPages}</span>
                </>
              ) : (
                '… / …'
              )}
            </button>
          )}
          <Button
            variant="ghost"
            size="icon"
            disabled={!numPages || currentPage >= numPages}
            onClick={() => goToPage(currentPage + 1)}
            aria-label="Trang sau"
            className="h-7 w-7"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Zoom — ẩn trong compact mode (sidebar inline 320px) */}
        {!compact && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setManualScale((s) => Math.max(0.4, (s ?? fitScale) - 0.1))
              }
              aria-label="Thu nhỏ"
              className="h-7 w-7"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <button
              type="button"
              onClick={() => setManualScale(null)}
              className={cn(
                'rounded px-2 py-1 text-xs tabular-nums hover:bg-muted',
                manualScale === null && 'text-primary font-medium',
              )}
              title="Click để fit chiều rộng"
            >
              {(scale * 100).toFixed(0)}%
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setManualScale((s) => Math.min(2.5, (s ?? fitScale) + 0.1))
              }
              aria-label="Phóng to"
              className="h-7 w-7"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setManualScale(null)}
              aria-label="Fit chiều rộng"
              title="Fit chiều rộng"
              className="h-7 w-7"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* ── PDF area ─────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overscroll-contain bg-muted/40 px-4 py-4"
      >
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
            file={pdfBlobUrl}
            options={pdfOptions}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={(err) => {
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
            className="flex flex-col items-center gap-3"
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
                    data-page-number={pageNumber}
                    id={`page-${pageNumber}`}
                    className={cn(
                      'relative overflow-hidden rounded-md bg-background shadow-md transition-all',
                      isCurrent && 'ring-2 ring-primary ring-offset-2 ring-offset-muted/40',
                    )}
                  >
                    {/* Page number badge — góc trên-trái, ẩn khi current để nhường ring */}
                    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-sm backdrop-blur">
                      {pageNumber}
                    </div>
                    <Page
                      pageNumber={pageNumber}
                      scale={scale}
                      renderAnnotationLayer
                      renderTextLayer
                      onLoadSuccess={(p) => {
                        // Lưu natural width của page đầu (giả sử các page cùng kích thước)
                        if (pageNumber === 1 && !naturalPageWidth.current) {
                          naturalPageWidth.current = p.originalWidth;
                          // Trigger compute fit
                          const container = containerRef.current;
                          if (container) {
                            const cw = container.clientWidth;
                            const available = Math.max(200, cw - 32);
                            setFitScale(
                              Math.min(2.5, Math.max(0.4, available / p.originalWidth)),
                            );
                          }
                        }
                      }}
                      onRenderError={swallowAbortError}
                      onRenderTextLayerError={swallowAbortError}
                      onGetAnnotationsError={swallowAbortError}
                    />
                  </div>
                );
              })}
          </Document>
        )}
      </div>
    </div>
  );
});
