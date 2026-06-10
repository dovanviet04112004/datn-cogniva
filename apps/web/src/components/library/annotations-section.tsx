/**
 * AnnotationsSection — Bonus #8 page-level notes (Phase 3, 2026-05-27).
 *
 * Section riêng dưới detail page:
 *   - Form thêm note (page number + text + visibility public/private)
 *   - List notes sorted by helpful_count DESC + most recent
 *   - Vote helpful toggle per note
 *   - Author có thể xoá note của mình
 *
 * Phase 4 sẽ thêm: pixel-perfect text selection overlay trên PDF.
 */
'use client';

import * as React from 'react';
import {
  EyeOff,
  Loader2,
  MessageCircle,
  Pin,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiSend, apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/use-confirm';
import { useT } from '@/lib/i18n/context';

// SectionHeading dùng chung toàn app (thay bản local cũ ở related-docs-section).
import { SectionHeading } from '@/components/ui/section-heading';
import {
  ANNOTATION_FOCUS_EVENT,
  ANNOTATION_HOVER_EVENT,
  ANNOTATION_PREVIEW_LIMIT_EVENT,
  ANNOTATION_SELECT_EVENT,
  ANNOTATIONS_LOADED_EVENT,
  type AnnotationFocusDetail,
  type AnnotationHoverDetail,
  type AnnotationPreviewLimitDetail,
  type AnnotationSelectDetail,
  type AnnotationSelectionRect,
  type AnnotationsLoadedDetail,
} from './annotation-events';

type Annotation = {
  id: string;
  pageNum: number;
  note: string;
  selectedText: string | null;
  selectionRect: AnnotationSelectionRect | null;
  visibility: 'public' | 'private';
  helpfulCount: number;
  createdAt: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  hasVoted: boolean;
};

export type AnnotationPrefill = {
  pageNum: number;
  selectedText: string;
};

export function AnnotationsSection({ docId }: { docId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = React.useState(false);
  const [pageNum, setPageNum] = React.useState(1);
  const [note, setNote] = React.useState('');
  const [selectedText, setSelectedText] = React.useState<string | null>(null);
  const [selectionRect, setSelectionRect] = React.useState<AnnotationSelectionRect | null>(null);
  const [visibility, setVisibility] = React.useState<'public' | 'private'>('public');
  const [submitting, setSubmitting] = React.useState(false);
  // Phase 4 Step 3: hover state đến từ preview → highlight card tương ứng
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  // Flash animation khi user click rect overlay trong preview (FOCUS event).
  const [flashId, setFlashId] = React.useState<string | null>(null);
  // Số trang user thật sự xem được — broadcast từ DocPreviewPanel.
  // Mặc định 5 (PREVIEW_PAGE_COUNT_DEFAULT), update khi event fire.
  const [visiblePageLimit, setVisiblePageLimit] = React.useState(5);
  const [fullAccess, setFullAccess] = React.useState(false);

  React.useEffect(() => {
    const onLimit = (e: Event) => {
      const ce = e as CustomEvent<AnnotationPreviewLimitDetail>;
      setVisiblePageLimit(ce.detail.visiblePageCount);
      setFullAccess(ce.detail.fullAccess);
    };
    window.addEventListener(ANNOTATION_PREVIEW_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(ANNOTATION_PREVIEW_LIMIT_EVENT, onLimit);
  }, []);

  // Phase 4: listen text-selection event từ DocPreviewPanel
  React.useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<AnnotationSelectDetail>;
      const { pageNum: pn, selectedText: txt, selectionRect: rect } = ce.detail;
      setPageNum(pn);
      setSelectedText(txt);
      setSelectionRect(rect);
      setFormOpen(true);
      requestAnimationFrame(() => {
        document
          .getElementById('annotation-form-section')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    };
    window.addEventListener(ANNOTATION_SELECT_EVENT, handler);
    return () => window.removeEventListener(ANNOTATION_SELECT_EVENT, handler);
  }, []);

  // Hover từ preview → highlight card tương ứng (bỏ qua nếu source = list)
  React.useEffect(() => {
    const onHover = (e: Event) => {
      const ce = e as CustomEvent<AnnotationHoverDetail>;
      if (ce.detail.source === 'list') return;
      setHoveredId(ce.detail.id);
    };
    window.addEventListener(ANNOTATION_HOVER_EVENT, onHover);
    return () => window.removeEventListener(ANNOTATION_HOVER_EVENT, onHover);
  }, []);

  // Focus event (click rect overlay) → scroll vào card + flash
  React.useEffect(() => {
    const onFocus = (e: Event) => {
      const ce = e as CustomEvent<AnnotationFocusDetail>;
      const id = ce.detail.id;
      setFlashId(id);
      requestAnimationFrame(() => {
        document
          .getElementById(`annotation-card-${id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      // Hết flash sau 1.6s
      window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600);
    };
    window.addEventListener(ANNOTATION_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(ANNOTATION_FOCUS_EVENT, onFocus);
  }, []);

  type AnnotData = { annotations: Annotation[]; viewerId: string | null };
  const { data, isLoading: loading, refetch } = useQuery({
    queryKey: qk.libraryDocAnnotations(docId),
    queryFn: () =>
      apiGet<AnnotData>(`/api/library/docs/${docId}/annotations`),
  });
  const annotations = data?.annotations ?? [];
  const viewerId = data?.viewerId ?? null;

  // Phase 4 Step 3: broadcast cho preview cache overlay items khi list load/đổi.
  React.useEffect(() => {
    if (!data) return;
    const payload: AnnotationsLoadedDetail = {
      items: data.annotations.map((a) => ({
        id: a.id,
        pageNum: a.pageNum,
        authorName: a.authorName,
        note: a.note,
        selectionRect: a.selectionRect,
      })),
    };
    window.dispatchEvent(
      new CustomEvent(ANNOTATIONS_LOADED_EVENT, { detail: payload }),
    );
  }, [data]);

  const submit = async () => {
    if (note.trim().length < 2) {
      toast.error(t('library.annot.note_short'));
      return;
    }
    setSubmitting(true);
    try {
      await apiSend(`/api/library/docs/${docId}/annotations`, 'POST', {
        pageNum,
        note: note.trim(),
        visibility,
        ...(selectedText ? { selectedText } : {}),
        ...(selectionRect ? { selectionRect } : {}),
      });
      toast.success(t('library.annot.added'));
      setNote('');
      setSelectedText(null);
      setSelectionRect(null);
      setFormOpen(false);
      void refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const vote = async (annotationId: string) => {
    try {
      const res = await apiSend<{ voted: boolean; helpfulCount: number }>(
        `/api/library/annotations/${annotationId}/vote`,
        'POST',
      );
      // Cập nhật tại chỗ trong cache (không refetch cả list).
      qc.setQueryData<AnnotData>(qk.libraryDocAnnotations(docId), (old) =>
        old
          ? {
              ...old,
              annotations: old.annotations.map((a) =>
                a.id === annotationId
                  ? { ...a, hasVoted: res.voted, helpfulCount: res.helpfulCount }
                  : a,
              ),
            }
          : old,
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async (annotationId: string) => {
    const ok = await confirm({ title: t('library.annot.delete_confirm'), variant: 'destructive' });
    if (!ok) return;
    try {
      await apiSend(`/api/library/annotations/${annotationId}`, 'DELETE');
      toast.success(t('library.annot.deleted'));
      qc.setQueryData<AnnotData>(qk.libraryDocAnnotations(docId), (old) =>
        old
          ? { ...old, annotations: old.annotations.filter((a) => a.id !== annotationId) }
          : old,
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // Group by page for organized display
  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations) {
    if (!byPage.has(a.pageNum)) byPage.set(a.pageNum, []);
    byPage.get(a.pageNum)!.push(a);
  }
  const pageNums = Array.from(byPage.keys()).sort((a, b) => a - b);

  return (
    <section className="mt-8 space-y-4">
      {/* Tiêu đề mục ghi chú + nút "Thêm ghi chú" slot action bên phải. */}
      <SectionHeading
        count={annotations.length}
        action={
          !formOpen ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="text-[11.5px] font-semibold text-primary hover:underline"
            >
              {t('library.annot.add_note')}
            </button>
          ) : undefined
        }
      >
        <span className="inline-flex items-center gap-2">
          <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
          {t('library.annot.section_title')}
        </span>
      </SectionHeading>
      {!formOpen && annotations.length === 0 && (
        <p className="rounded-lg border border-dashed border-divider bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
          {t('library.annot.tip')}<strong>{t('library.annot.tip_label')}</strong>
          {t('library.annot.tip_body')}{' '}
          {fullAccess
            ? t('library.annot.tip_full').replace('{count}', String(visiblePageLimit))
            : t('library.annot.tip_preview').replace('{count}', String(visiblePageLimit))}
        </p>
      )}

      {/* Form */}
      {formOpen && (
        <form
          id="annotation-form-section"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-2.5 rounded-xl border border-primary/40 bg-card p-3.5 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1 text-[12px] font-semibold">
              <Pin className="h-3.5 w-3.5 text-primary" />
              {t('library.annot.add_heading')}
            </p>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setNote('');
                setSelectedText(null);
              }}
              aria-label={t('library.annot.close_form_aria')}
              className="rounded p-1 hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {selectedText && (
            <div className="flex items-start gap-2 rounded-md border-l-2 border-amber-500 bg-amber-500/5 px-2 py-1.5">
              <p className="text-[11.5px] italic text-foreground/85">
                &ldquo;{selectedText.length > 200 ? selectedText.slice(0, 200) + '…' : selectedText}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setSelectedText(null)}
                aria-label={t('library.annot.clear_selection_aria')}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                title={t('library.annot.clear_selection_title')}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('library.annot.page')}
            </label>
            <input
              type="number"
              min={1}
              max={visiblePageLimit}
              value={pageNum}
              onChange={(e) => {
                const n = Number(e.target.value) || 1;
                // Clamp theo số trang đang xem được
                setPageNum(Math.max(1, Math.min(visiblePageLimit, n)));
              }}
              className="w-20 rounded-md border border-divider bg-background px-2 py-1 text-[12px]"
            />
            <span className="text-[10.5px] text-muted-foreground">
              / {visiblePageLimit} {fullAccess ? t('library.annot.page_unit') : t('library.annot.page_preview_unit')}
            </span>
            <label className="ml-2 inline-flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={visibility === 'private'}
                onChange={(e) => setVisibility(e.target.checked ? 'private' : 'public')}
                className="h-3.5 w-3.5 accent-discovery-600"
              />
              <EyeOff className="h-3 w-3" />
              {t('library.annot.private')}
            </label>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('library.annot.note_placeholder')}
            rows={3}
            maxLength={2000}
            className="resize-none text-[12.5px]"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-muted-foreground">
              {note.length}/2000
            </span>
            <Button type="submit" size="sm" disabled={submitting || note.trim().length < 2}>
              {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {t('library.annot.post_note')}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t('library.annot.loading')}</p>
      ) : annotations.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">
          {t('library.annot.empty')}{' '}
          {!formOpen && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="font-semibold text-primary hover:underline"
            >
              {t('library.annot.write_first')}
            </button>
          )}
        </p>
      ) : (
        <div className="space-y-3">
          {pageNums.map((pn) => (
            <div key={pn}>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('library.annot.page')} {pn} ({byPage.get(pn)!.length})
              </p>
              <ul className="space-y-2">
                {byPage.get(pn)!.map((a) => {
                  const isOwn = viewerId === a.authorId;
                  const isHover = hoveredId === a.id;
                  const isFlash = flashId === a.id;
                  return (
                    <li
                      key={a.id}
                      id={`annotation-card-${a.id}`}
                      onMouseEnter={() => {
                        setHoveredId(a.id);
                        window.dispatchEvent(
                          new CustomEvent(ANNOTATION_HOVER_EVENT, {
                            detail: { id: a.id, source: 'list' },
                          }),
                        );
                      }}
                      onMouseLeave={() => {
                        setHoveredId(null);
                        window.dispatchEvent(
                          new CustomEvent(ANNOTATION_HOVER_EVENT, {
                            detail: { id: null, source: 'list' },
                          }),
                        );
                      }}
                      className={cn(
                        'rounded-xl border bg-card p-3 transition-all',
                        a.visibility === 'private'
                          ? 'border-amber-500/30'
                          : 'border-divider',
                        isHover && 'ring-2 ring-amber-500/50 shadow-md',
                        isFlash && 'ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-950/30',
                      )}
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={a.authorImage ?? undefined} />
                            <AvatarFallback className="text-[9px]">
                              {(a.authorName ?? '?')[0]?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-[11.5px] font-semibold">
                            {a.authorName}
                          </span>
                          {a.visibility === 'private' && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-700 dark:text-amber-300">
                              <EyeOff className="h-2.5 w-2.5" />
                              {t('library.annot.private_badge')}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(a.createdAt).toLocaleDateString('vi-VN')}
                          </span>
                        </div>
                        {isOwn && (
                          <button
                            type="button"
                            onClick={() => remove(a.id)}
                            aria-label={t('library.annot.delete_aria')}
                            className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                            title={t('library.annot.delete_title')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {a.selectedText && (
                        <div className="my-1.5 rounded border-l-2 border-amber-500 bg-amber-500/5 px-2 py-1">
                          <p className="text-[11px] italic text-foreground/80">
                            &ldquo;{a.selectedText.length > 200 ? a.selectedText.slice(0, 200) + '…' : a.selectedText}&rdquo;
                          </p>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">
                        {a.note}
                      </p>
                      <button
                        type="button"
                        onClick={() => vote(a.id)}
                        disabled={!viewerId}
                        className={cn(
                          'mt-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium transition-colors disabled:opacity-50',
                          a.hasVoted
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-divider text-muted-foreground hover:border-emerald-500/30 hover:text-emerald-600',
                        )}
                      >
                        <ThumbsUp className="h-2.5 w-2.5" />
                        {a.hasVoted ? t('library.annot.voted') : t('library.annot.vote')} ({a.helpfulCount})
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

