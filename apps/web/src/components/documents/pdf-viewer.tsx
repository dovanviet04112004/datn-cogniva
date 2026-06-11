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

if (typeof pdfjs.GlobalWorkerOptions !== 'undefined') {
  const pdfjsAny = pdfjs as unknown as {
    VerbosityLevel?: { ERRORS: number };
    setVerbosityLevel?: (level: number) => void;
  };
  if (pdfjsAny.VerbosityLevel && pdfjsAny.setVerbosityLevel) {
    pdfjsAny.setVerbosityLevel(pdfjsAny.VerbosityLevel.ERRORS);
  }
}

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

function swallowAbortError(err: Error): void {
  if (err?.name === 'AbortException' || /AbortException/i.test(err?.message ?? '')) {
    return;
  }
  console.error('[pdf-viewer]', err);
}

type Props = {
  src: string;
  initialPage?: number;
  compact?: boolean;
};

export type PdfViewerHandle = {
  goToPage: (n: number) => void;
};

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { src, initialPage, compact = false },
  ref,
) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [targetPage, setTargetPage] = useState(initialPage ?? 1);
  const [visiblePage, setVisiblePage] = useState(initialPage ?? 1);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pageInputEditing, setPageInputEditing] = useState(false);
  const [pageInputValue, setPageInputValue] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const naturalPageWidth = useRef<number | null>(null);

  const scale = manualScale ?? fitScale;

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

  useEffect(() => {
    if (!pdfBlob) {
      setPdfBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(pdfBlob);
    setPdfBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfBlob]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const compute = () => {
      const cw = container.clientWidth;
      const pw = naturalPageWidth.current;
      if (!pw) return;
      const available = Math.max(200, cw - 32);
      setFitScale(Math.min(2.5, Math.max(0.4, available / pw)));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [pdfBlobUrl, numPages]);

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

  useEffect(() => {
    if (initialPage !== undefined) setTargetPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    const el = pageRefs.current.get(targetPage);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setVisiblePage(targetPage);
    }
  }, [targetPage, numPages]);

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

  const currentPage = visiblePage;

  const goToPage = (n: number) => {
    if (!numPages) return;
    setTargetPage(Math.max(1, Math.min(numPages, n)));
  };

  useImperativeHandle(
    ref,
    () => ({
      goToPage: (n: number) => {
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
      <div className="bg-background/80 flex items-center justify-between gap-2 border-b px-3 py-1.5 backdrop-blur">
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
                className="bg-background focus:ring-ring w-12 rounded border px-1.5 py-0.5 text-center tabular-nums outline-none focus:ring-1"
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
              className="hover:bg-muted rounded px-2 py-1 text-xs tabular-nums"
              title="Click để nhập trang"
            >
              {numPages ? (
                <>
                  <span className="text-foreground font-medium">{currentPage}</span>
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

        {!compact && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setManualScale((s) => Math.max(0.4, (s ?? fitScale) - 0.1))}
              aria-label="Thu nhỏ"
              className="h-7 w-7"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <button
              type="button"
              onClick={() => setManualScale(null)}
              className={cn(
                'hover:bg-muted rounded px-2 py-1 text-xs tabular-nums',
                manualScale === null && 'text-primary font-medium',
              )}
              title="Click để fit chiều rộng"
            >
              {(scale * 100).toFixed(0)}%
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setManualScale((s) => Math.min(2.5, (s ?? fitScale) + 0.1))}
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

      <div
        ref={containerRef}
        className="bg-muted/40 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {fetchError ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-6 text-sm">
            Không tải được PDF: {fetchError}
          </div>
        ) : !pdfBlobUrl ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
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
                <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
              </div>
            }
            error={
              <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-6 text-sm">
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
                      'bg-background relative overflow-hidden rounded-md shadow-md transition-all',
                      isCurrent && 'ring-primary ring-offset-muted/40 ring-2 ring-offset-2',
                    )}
                  >
                    <div className="bg-background/80 text-muted-foreground pointer-events-none absolute left-2 top-2 z-10 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums shadow-sm backdrop-blur">
                      {pageNumber}
                    </div>
                    <Page
                      pageNumber={pageNumber}
                      scale={scale}
                      renderAnnotationLayer
                      renderTextLayer
                      onLoadSuccess={(p) => {
                        if (pageNumber === 1 && !naturalPageWidth.current) {
                          naturalPageWidth.current = p.originalWidth;
                          const container = containerRef.current;
                          if (container) {
                            const cw = container.clientWidth;
                            const available = Math.max(200, cw - 32);
                            setFitScale(Math.min(2.5, Math.max(0.4, available / p.originalWidth)));
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
