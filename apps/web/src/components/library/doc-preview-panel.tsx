'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  Download,
  FileImage,
  FileText,
  Info,
  Loader2,
  RotateCw,
} from 'lucide-react';
import { toast } from 'sonner';

import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';

import {
  ANNOTATION_FOCUS_EVENT,
  ANNOTATION_HOVER_EVENT,
  ANNOTATION_PREVIEW_LIMIT_EVENT,
  ANNOTATION_SELECT_EVENT,
  ANNOTATIONS_LOADED_EVENT,
  type AnnotationHoverDetail,
  type AnnotationOverlayItem,
  type AnnotationsLoadedDetail,
} from './annotation-events';

export { ANNOTATION_SELECT_EVENT } from './annotation-events';

const Document = dynamic(() => import('react-pdf').then((m) => m.Document), { ssr: false });
const Page = dynamic(() => import('react-pdf').then((m) => m.Page), { ssr: false });

const PREVIEW_PAGE_COUNT_DEFAULT = 5;

export function DocPreviewPanel({
  docId,
  fileFormat,
  thumbUrl,
  title,
  fullAccess = false,
}: {
  docId: string;
  fileFormat: string;
  thumbUrl: string | null;
  title: string;
  fullAccess?: boolean;
}) {
  const t = useT();
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [demoMessage, setDemoMessage] = React.useState<string | null>(null);
  const [numPages, setNumPages] = React.useState<number | null>(null);

  const effectivePreviewLimit = fullAccess
    ? (numPages ?? PREVIEW_PAGE_COUNT_DEFAULT)
    : PREVIEW_PAGE_COUNT_DEFAULT;

  React.useEffect(() => {
    const visibleCount = numPages
      ? Math.min(effectivePreviewLimit, numPages)
      : effectivePreviewLimit;
    window.dispatchEvent(
      new CustomEvent(ANNOTATION_PREVIEW_LIMIT_EVENT, {
        detail: { visiblePageCount: visibleCount, fullAccess },
      }),
    );
  }, [numPages, effectivePreviewLimit, fullAccess]);
  const [overlayItems, setOverlayItems] = React.useState<AnnotationOverlayItem[]>([]);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = React.useState<number>(600);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(280, Math.min(700, e.contentRect.width - 32));
        setPageWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const onLoaded = (e: Event) => {
      const ce = e as CustomEvent<AnnotationsLoadedDetail>;
      setOverlayItems(ce.detail.items.filter((i) => i.selectionRect));
    };
    const onHover = (e: Event) => {
      const ce = e as CustomEvent<AnnotationHoverDetail>;
      if (ce.detail.source === 'preview') return;
      setHoveredId(ce.detail.id);
    };
    window.addEventListener(ANNOTATIONS_LOADED_EVENT, onLoaded);
    window.addEventListener(ANNOTATION_HOVER_EVENT, onHover);
    return () => {
      window.removeEventListener(ANNOTATIONS_LOADED_EVENT, onLoaded);
      window.removeEventListener(ANNOTATION_HOVER_EVENT, onHover);
    };
  }, []);

  const loadPdf = React.useCallback(async () => {
    if (pdfUrl) return;
    setLoading(true);
    setError(null);
    setDemoMessage(null);
    try {
      const res = await fetch(`/api/library/docs/${docId}/download`);
      if (!res.ok) throw new Error(t('library.preview.load_failed'));
      const data = (await res.json()) as {
        url?: string;
        demo?: boolean;
        message?: string;
      };
      if (data.demo) {
        setDemoMessage(data.message ?? t('library.preview.demo_default'));
        return;
      }
      setPdfUrl(`/api/library/docs/${docId}/file`);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [pdfUrl, docId, t]);

  React.useEffect(() => {
    if (fileFormat === 'pdf') {
      void import('react-pdf').then((mod) => {
        const version = mod.pdfjs.version;
        mod.pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
      });
      void loadPdf();
    }
  }, [fileFormat, loadPdf]);

  return (
    <div className="border-divider bg-card relative overflow-hidden rounded-2xl border">
      <WatermarkOverlay />

      <div className="from-card pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center bg-gradient-to-b to-transparent py-2">
        <span className="bg-discovery-500/15 text-discovery-700 dark:text-discovery-300 rounded-full px-2.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider">
          📚 Cogniva Library Preview ·{' '}
          {fullAccess
            ? t('library.preview.label_unlocked').replace('{count}', String(numPages ?? '...'))
            : t('library.preview.label_first').replace(
                '{count}',
                String(PREVIEW_PAGE_COUNT_DEFAULT),
              )}
        </span>
      </div>

      <div ref={scrollRef} className="relative z-0 max-h-[78vh] overflow-y-auto p-4 pt-10">
        {fileFormat === 'image' ? (
          <ImagePreview thumbUrl={thumbUrl} title={title} />
        ) : fileFormat === 'docx' ? (
          <DocxPreview thumbUrl={thumbUrl} title={title} docId={docId} />
        ) : (
          <>
            {loading && (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('library.preview.loading_pdf')}
              </div>
            )}
            {demoMessage && (
              <div className="border-discovery-500/30 bg-discovery-500/5 flex flex-col items-center gap-3 rounded-lg border px-4 py-10 text-center">
                <Info className="text-discovery-600 h-6 w-6" />
                <p className="text-discovery-700 dark:text-discovery-300 text-[13px] font-medium">
                  {t('library.preview.demo_title')}
                </p>
                <p className="text-muted-foreground max-w-md text-[12px]">{demoMessage}</p>
                <p className="text-muted-foreground/70 text-[11px]">
                  {t('library.preview.demo_hint')}
                </p>
              </div>
            )}
            {error && (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-8 text-center">
                <div className="rounded-full bg-rose-500/15 p-2">
                  <AlertTriangle className="h-5 w-5 text-rose-600" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">
                    {t('library.preview.load_failed')}
                  </p>
                  <p className="text-muted-foreground mt-1 max-w-xs text-[11.5px]">{error}</p>
                </div>
                {thumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbUrl}
                    alt={title}
                    className="border-divider aspect-[3/4] w-32 rounded-md border object-cover opacity-60"
                  />
                )}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={loadPdf}>
                    <RotateCw className="mr-1 h-3 w-3" />
                    {t('library.preview.retry')}
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`/api/library/docs/${docId}/download`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="mr-1 h-3 w-3" />
                      {t('library.preview.download_view')}
                    </a>
                  </Button>
                </div>
              </div>
            )}
            {!loading && !error && pdfUrl && (
              <Document
                file={pdfUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                onLoadError={(e: Error) =>
                  setError(t('library.preview.pdf_error').replace('{msg}', e.message))
                }
                loading={
                  <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('library.preview.render_pdf')}
                  </div>
                }
                error={
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-[12px] text-rose-700 dark:text-rose-300">
                    {t('library.preview.render_failed')}
                  </div>
                }
                className="flex flex-col items-center gap-3"
              >
                {Array.from(
                  { length: Math.min(effectivePreviewLimit, numPages ?? effectivePreviewLimit) },
                  (_, i) => i + 1,
                ).map((pageNum) => (
                  <div
                    key={pageNum}
                    className="border-divider relative rounded-lg border bg-white shadow-md"
                    onMouseUp={(e) => {
                      const sel = window.getSelection();
                      const text = sel?.toString().trim();
                      if (!text || text.length < 5 || text.length > 500) return;
                      let rectNorm: {
                        pageW: number;
                        pageH: number;
                        x: number;
                        y: number;
                        w: number;
                        h: number;
                      } | null = null;
                      try {
                        const range = sel!.getRangeAt(0);
                        const rectSel = range.getBoundingClientRect();
                        const pageEl = e.currentTarget as HTMLDivElement;
                        const rectPage = pageEl.getBoundingClientRect();
                        if (rectPage.width > 0 && rectPage.height > 0) {
                          const clamp = (n: number) => Math.max(0, Math.min(1, n));
                          rectNorm = {
                            pageW: rectPage.width,
                            pageH: rectPage.height,
                            x: clamp((rectSel.left - rectPage.left) / rectPage.width),
                            y: clamp((rectSel.top - rectPage.top) / rectPage.height),
                            w: clamp(rectSel.width / rectPage.width),
                            h: clamp(rectSel.height / rectPage.height),
                          };
                        }
                      } catch {}
                      window.dispatchEvent(
                        new CustomEvent(ANNOTATION_SELECT_EVENT, {
                          detail: {
                            pageNum,
                            selectedText: text,
                            selectionRect: rectNorm,
                          },
                        }),
                      );
                    }}
                  >
                    <Page
                      pageNumber={pageNum}
                      width={pageWidth}
                      renderAnnotationLayer={false}
                      renderTextLayer={true}
                      className="overflow-hidden rounded-lg"
                      loading={
                        <div
                          className="bg-muted/20 flex items-center justify-center"
                          style={{
                            width: pageWidth,
                            height: pageWidth * 1.414,
                          }}
                        >
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      }
                    />
                    <PerPageWatermark pageNum={pageNum} />
                    <PageHighlightOverlay
                      pageNum={pageNum}
                      items={overlayItems}
                      hoveredId={hoveredId}
                      onHover={(id) => {
                        setHoveredId(id);
                        window.dispatchEvent(
                          new CustomEvent(ANNOTATION_HOVER_EVENT, {
                            detail: { id, source: 'preview' },
                          }),
                        );
                      }}
                      onFocus={(id) => {
                        window.dispatchEvent(
                          new CustomEvent(ANNOTATION_FOCUS_EVENT, {
                            detail: { id },
                          }),
                        );
                      }}
                    />
                  </div>
                ))}
                {numPages && numPages > effectivePreviewLimit && !fullAccess && (
                  <p className="text-muted-foreground mt-2 text-center text-[11.5px]">
                    {t('library.preview.page_count_info')
                      .replace('{shown}', String(effectivePreviewLimit))
                      .replace('{total}', String(numPages))}
                  </p>
                )}
              </Document>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ImagePreview({ thumbUrl, title }: { thumbUrl: string | null; title: string }) {
  return (
    <div className="bg-muted relative mx-auto max-w-md overflow-hidden rounded-xl">
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl} alt={title} className="h-auto w-full" />
      ) : (
        <div className="flex aspect-square items-center justify-center">
          <FileImage className="text-muted-foreground/40 h-12 w-12" />
        </div>
      )}
    </div>
  );
}

function DocxPreview({
  thumbUrl,
  title,
  docId,
}: {
  thumbUrl: string | null;
  title: string;
  docId: string;
}) {
  const t = useT();
  const [fileUrl, setFileUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [iframeBlocked, setIframeBlocked] = React.useState(false);
  const [demoMessage, setDemoMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/library/docs/${docId}/download`);
        if (!res.ok) {
          if (res.status === 402) {
            setDemoMessage(t('library.preview.premium_need_buy'));
          } else {
            setDemoMessage(t('library.preview.file_load_failed'));
          }
          return;
        }
        const data = (await res.json()) as {
          url?: string;
          demo?: boolean;
          message?: string;
        };
        if (cancelled) return;
        if (data.demo) {
          setDemoMessage(data.message ?? t('library.preview.demo_default'));
          return;
        }
        if (data.url) setFileUrl(data.url);
      } catch {
        if (!cancelled) setDemoMessage(t('library.preview.file_load_failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, t]);

  const officeEmbedSrc = fileUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`
    : null;

  const openInNewTab = () => {
    if (fileUrl) window.open(fileUrl, '_blank');
  };

  return (
    <div className="flex flex-col gap-3">
      {loading && (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('library.preview.loading_docx')}
        </div>
      )}

      {demoMessage && (
        <div className="border-discovery-500/30 bg-discovery-500/5 flex flex-col items-center gap-3 rounded-lg border px-4 py-10 text-center">
          <Info className="text-discovery-600 h-6 w-6" />
          <p className="text-muted-foreground text-[12px]">{demoMessage}</p>
        </div>
      )}

      {officeEmbedSrc && !iframeBlocked && (
        <div className="border-divider relative overflow-hidden rounded-lg border bg-white shadow-md">
          <iframe
            src={officeEmbedSrc}
            title={title}
            className="h-[700px] w-full"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
            onError={() => setIframeBlocked(true)}
            allowFullScreen
          />
          <PerPageWatermark pageNum={1} />
        </div>
      )}

      {iframeBlocked && (
        <div className="flex flex-col items-center gap-4 py-6">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbUrl}
              alt={title}
              className="border-divider aspect-[3/4] w-56 rounded-lg border object-cover shadow-md"
            />
          ) : (
            <div className="border-divider bg-muted flex aspect-[3/4] w-56 items-center justify-center rounded-lg border">
              <FileText className="text-muted-foreground/40 h-12 w-12" />
            </div>
          )}
          <p className="text-muted-foreground text-[11.5px]">
            {t('library.preview.office_blocked')}
          </p>
        </div>
      )}

      {fileUrl && (
        <Button onClick={openInNewTab} variant="outline" size="sm" className="self-center">
          <FileText className="mr-1 h-3.5 w-3.5" />
          {t('library.preview.open_docx')}
        </Button>
      )}
    </div>
  );
}

function WatermarkOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.04]">
        <p className="rotate-[-30deg] whitespace-nowrap text-[80px] font-bold uppercase tracking-widest">
          Cogniva Library
        </p>
      </div>
    </div>
  );
}

function PerPageWatermark({ pageNum }: { pageNum: number }) {
  const t = useT();
  return (
    <>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-10">
        <p className="text-discovery-700 dark:text-discovery-300 rotate-[-30deg] whitespace-nowrap text-[40px] font-bold uppercase tracking-widest">
          Cogniva
        </p>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
        <span className="bg-discovery-500/80 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
          Cogniva · {t('library.preview.page')} {pageNum}
        </span>
      </div>
    </>
  );
}

function PageHighlightOverlay({
  pageNum,
  items,
  hoveredId,
  onHover,
  onFocus,
}: {
  pageNum: number;
  items: AnnotationOverlayItem[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onFocus: (id: string) => void;
}) {
  const t = useT();
  const pageItems = items.filter((i) => i.pageNum === pageNum && i.selectionRect);
  if (pageItems.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {pageItems.map((item) => {
        const r = item.selectionRect!;
        const isHover = hoveredId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onMouseEnter={() => onHover(item.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onFocus(item.id)}
            aria-label={t('library.annot.overlay_aria')
              .replace('{author}', item.authorName ?? t('library.annot.anonymous'))
              .replace('{note}', item.note.slice(0, 80))}
            title={`${item.authorName ?? t('library.annot.anonymous')}: ${item.note.slice(0, 120)}${item.note.length > 120 ? '…' : ''}`}
            className={cn(
              'pointer-events-auto absolute cursor-pointer rounded-sm border-2 transition-all',
              isHover
                ? 'border-amber-600 bg-amber-400/40 shadow-[0_0_0_3px_rgba(245,158,11,0.35)]'
                : 'border-amber-500/60 bg-amber-300/25 hover:bg-amber-300/40',
            )}
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}
