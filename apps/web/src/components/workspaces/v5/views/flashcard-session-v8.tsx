/**
 * FlashcardSessionV8 — UI mới cho FC review trong workspace V5+.
 *
 * V8.10 (2026-05-20). Thay thế cách reuse `<ReviewSession>` của trang
 * `/flashcards/review` cũ trong [`FlashcardView`]. Lý do: ReviewSession có
 * chrome "premium card" hợp với full-page nhưng cồng kềnh khi embed trong
 * MainPanel V5 (đã có header + scope chip).
 *
 * V8 redesign:
 *   - Layout đơn giản hơn — không max-w-2xl, fit thẳng MainPanel center
 *   - Progress: 1 thanh ngang trên cùng, không counter dạng "1 / 24"
 *   - Card: rounded-xl tối giản, padding cân đối
 *   - Rating: 4 button đồng đều, label tiếng Việt + kbd hint
 *   - Support cả 3 card type (BASIC / CLOZE / IMAGE_OCCLUSION) qua existing
 *     ClozeRenderer + ImageOcclusionViewer
 *
 * API: /api/flashcards/queue?workspaceId + /api/flashcards/[id]/review
 *   (giống ReviewSession — backend không đổi).
 *
 * Keyboard: Space/Enter reveal · 1-4 rating (giống cũ, user quen).
 */
'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { ClozeRenderer } from '@/components/flashcards/cloze-renderer';
import { ImageOcclusionViewer } from '@/components/flashcards/image-occlusion-viewer';
import type { Mask } from '@/components/flashcards/image-occlusion-editor';
import { cn } from '@/lib/utils';
import { useNotebook } from '../notebook-context';

type Flashcard = {
  id: string;
  cardType: 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION';
  front: string;
  back: string;
  state: string;
};

type Rating = {
  rating: number;
  label: string;
  key: string;
  className: string;
};

const RATINGS: Rating[] = [
  {
    rating: 1,
    label: 'Lại',
    key: '1',
    className:
      'border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10',
  },
  {
    rating: 2,
    label: 'Khó',
    key: '2',
    className:
      'border-orange-500/30 bg-orange-500/5 text-orange-600 hover:bg-orange-500/10 dark:text-orange-400',
  },
  {
    rating: 3,
    label: 'Tốt',
    key: '3',
    className:
      'border-success/30 bg-success/5 text-success hover:bg-success/10',
  },
  {
    rating: 4,
    label: 'Dễ',
    key: '4',
    className:
      'border-sky-500/30 bg-sky-500/5 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400',
  },
];

type Props = {
  workspaceId: string;
};

export function FlashcardSessionV8({ workspaceId }: Props) {
  const [queue, setQueue] = React.useState<Flashcard[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [idx, setIdx] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [startTime, setStartTime] = React.useState(Date.now());
  const [stats, setStats] = React.useState({ done: 0, good: 0 });
  /** V8.20: state khi đang gen flashcards từ empty state CTA. */
  const [generating, setGenerating] = React.useState(false);

  const { selectedDocs } = useNotebook();
  const queryClient = useQueryClient();

  // Load queue scope workspace
  const loadQueue = React.useCallback(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/flashcards/queue?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((d: { flashcards: Flashcard[] }) => {
        if (!cancelled) {
          setQueue(d.flashcards ?? []);
          setIdx(0);
          setStats({ done: 0, good: 0 });
        }
      })
      .catch(() => {
        if (!cancelled) toast.error('Load queue lỗi');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  React.useEffect(() => {
    const cleanup = loadQueue();
    return cleanup;
  }, [loadQueue]);

  /**
   * V8.20: gen flashcard từ doc đã check trong Sources → seed FC table.
   * Gen 10 thẻ BASIC từ doc đầu tiên đã check. User click lại để gen thêm
   * doc khác. Sau gen → loadQueue() để FSRS pick thẻ due.
   */
  const generateFlashcards = React.useCallback(async () => {
    if (generating) return;
    const docIds = Array.from(selectedDocs);
    if (docIds.length === 0) {
      toast.error('Chọn ít nhất 1 doc trong Sources để gen flashcard');
      return;
    }
    setGenerating(true);
    try {
      const r = await apiSend<{ created: number; skipped: number }>(
        '/api/flashcards/generate',
        'POST',
        { documentId: docIds[0], type: 'BASIC', limit: 10 },
      );
      // Dedup: báo số thẻ THẬT (có thể < 10 hoặc 0 nếu phần này đã có thẻ).
      toast.success(
        r.created > 0
          ? `Đã gen ${r.created} thẻ — load lại queue`
          : 'Phần đã chọn đã có đủ thẻ rồi (không tạo trùng)',
      );
      loadQueue();
    } catch (err) {
      toast.error('Gen FC lỗi: ' + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [generating, selectedDocs, loadQueue]);

  // Reset timer khi card đổi
  React.useEffect(() => {
    setStartTime(Date.now());
    setRevealed(false);
  }, [idx]);

  const current = queue[idx];

  const submitRating = React.useCallback(
    async (rating: number) => {
      if (!current || submitting) return;
      setSubmitting(true);
      const duration = Date.now() - startTime;
      try {
        await apiSend(`/api/flashcards/${current.id}/review`, 'POST', {
          rating,
          duration,
        });
        // Mastery vừa đổi → bust list atom (sources-panel) để status refetch ngay.
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'sources'] });
        // Thẻ vừa ôn → "đã ôn" ở trang quản trị cập nhật.
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'manage'] });
        setStats((s) => ({
          done: s.done + 1,
          good: s.good + (rating >= 3 ? 1 : 0),
        }));
        setIdx((i) => i + 1);
      } catch (err) {
        toast.error('Submit lỗi: ' + (err as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [current, submitting, startTime, queryClient, workspaceId],
  );

  // Keyboard shortcuts
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore khi đang typing trong input/textarea
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA')
        return;
      if (!current || submitting) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!revealed) setRevealed(true);
      } else if (['1', '2', '3', '4'].includes(e.key) && revealed) {
        submitRating(Number(e.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, revealed, submitting, submitRating]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!current) {
    return (
      <SessionDone
        stats={stats}
        onGenerate={generateFlashcards}
        generating={generating}
      />
    );
  }

  const total = queue.length;
  const progress = total > 0 ? ((idx + 1) / total) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Progress strip */}
      <div className="shrink-0 border-b bg-muted/10 px-4 py-2.5">
        <div className="mx-auto max-w-3xl">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-mono tabular-nums text-muted-foreground">
              {idx + 1} / {total}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              {current.state}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="px-6 py-7">
              <CardFront card={current} revealed={revealed} />
            </div>
            {revealed && (
              <div className="border-t bg-muted/20 px-6 py-6">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                  Đáp án
                </p>
                <CardBack card={current} />
              </div>
            )}
          </div>

          {/* Action row */}
          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              Hiện đáp án
              <kbd className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px]">
                Space
              </kbd>
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map((r) => (
                <button
                  key={r.rating}
                  onClick={() => submitRating(r.rating)}
                  disabled={submitting}
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-3 transition-colors disabled:opacity-50',
                    r.className,
                  )}
                >
                  <span className="text-[15px] font-semibold tracking-tight">
                    {r.label}
                  </span>
                  <kbd className="rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] opacity-70">
                    {r.key}
                  </kbd>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CardFront({ card, revealed }: { card: Flashcard; revealed: boolean }) {
  if (card.cardType === 'CLOZE') {
    return <ClozeRenderer text={card.front} revealed={revealed} />;
  }
  if (card.cardType === 'IMAGE_OCCLUSION') {
    const masks = parseMasks(card.back);
    return (
      <ImageOcclusionViewer
        imageUrl={card.front}
        masks={masks}
        revealed={revealed}
      />
    );
  }
  return (
    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/95">
      {card.front}
    </p>
  );
}

function CardBack({ card }: { card: Flashcard }) {
  if (card.cardType === 'CLOZE') {
    return (
      <p className="text-[12px] italic text-muted-foreground">
        Đáp án tô sáng trong câu phía trên.
      </p>
    );
  }
  if (card.cardType === 'IMAGE_OCCLUSION') {
    return (
      <p className="text-[12px] italic text-muted-foreground">
        Vùng cần học đã hiện trong ảnh.
      </p>
    );
  }
  return (
    <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">
      {card.back}
    </p>
  );
}

function parseMasks(raw: string): Mask[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.masks)) return parsed.masks as Mask[];
    return [];
  } catch {
    return [];
  }
}

function SessionDone({
  stats,
  onGenerate,
  generating,
}: {
  stats: { done: number; good: number };
  onGenerate: () => void;
  generating: boolean;
}) {
  const rate = stats.done > 0 ? Math.round((stats.good / stats.done) * 100) : 0;
  const isEmptyQueue = stats.done === 0;
  return (
    <div className="flex h-full items-center justify-center px-4 py-8">
      <div className="max-w-md space-y-4 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          {stats.done > 0 ? (
            <CheckCircle2 className="h-6 w-6 text-primary" />
          ) : (
            <Sparkles className="h-6 w-6 text-primary" />
          )}
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          {stats.done > 0 ? 'Xong phiên!' : 'Không còn thẻ đến hạn'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {stats.done > 0
            ? `Đã ôn ${stats.done} thẻ · retention ${rate}%`
            : 'Workspace chưa có flashcard nào tới hạn. Tạo mới từ doc đã check trong Sources.'}
        </p>
        {/* V8.20: 2 button — primary "Tạo FC" khi queue trống, secondary reload */}
        <div className="flex justify-center gap-2 pt-1">
          {isEmptyQueue && (
            <Button size="sm" onClick={onGenerate} disabled={generating}>
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {generating ? 'Đang gen…' : 'Tạo 10 flashcard'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RotateCcw className="h-3 w-3" />
            Tải lại queue
          </Button>
        </div>
      </div>
    </div>
  );
}
