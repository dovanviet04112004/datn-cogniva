'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw } from 'lucide-react';

import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { ClozeRenderer } from './cloze-renderer';
import { ImageOcclusionViewer } from './image-occlusion-viewer';
import type { Mask } from './image-occlusion-editor';

type Flashcard = {
  id: string;
  cardType: 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION';
  front: string;
  back: string;
  state: string;
};

type Props = {
  initial?: Flashcard[];
  workspaceId?: string;
};

const RATINGS = [
  {
    rating: 1,
    label: 'Lại',
    short: 'Again',
    key: '1',
    className:
      'border-red-500/30 bg-red-500/10 hover:border-red-500/50 hover:bg-red-500/15 text-red-600 dark:text-red-400',
  },
  {
    rating: 2,
    label: 'Khó',
    short: 'Hard',
    key: '2',
    className:
      'border-orange-500/30 bg-orange-500/10 hover:border-orange-500/50 hover:bg-orange-500/15 text-orange-600 dark:text-orange-400',
  },
  {
    rating: 3,
    label: 'Tốt',
    short: 'Good',
    key: '3',
    className:
      'border-green-500/30 bg-green-500/10 hover:border-green-500/50 hover:bg-green-500/15 text-green-600 dark:text-green-400',
  },
  {
    rating: 4,
    label: 'Dễ',
    short: 'Easy',
    key: '4',
    className:
      'border-blue-500/30 bg-blue-500/10 hover:border-blue-500/50 hover:bg-blue-500/15 text-blue-600 dark:text-blue-400',
  },
];

export function ReviewSession({ initial, workspaceId }: Props) {
  const router = useRouter();
  const { data: fetchedQueue, isLoading } = useQuery({
    queryKey: qk.flashcardQueue(workspaceId),
    queryFn: () =>
      apiGet<{ flashcards: Flashcard[] }>(
        `/api/flashcards/queue${workspaceId ? `?workspaceId=${workspaceId}` : ''}`,
      ).then((d) => d.flashcards),
    enabled: !initial,
    initialData: initial,
  });
  const queue = fetchedQueue ?? [];
  const loading = !initial && isLoading;
  const [idx, setIdx] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [startTime, setStartTime] = React.useState(Date.now());
  const [stats, setStats] = React.useState({ done: 0, good: 0 });

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
        await apiSend(`/api/flashcards/${current.id}/review`, 'POST', { rating, duration });
        setStats((s) => ({ done: s.done + 1, good: s.good + (rating >= 3 ? 1 : 0) }));
        setIdx((i) => i + 1);
      } catch (err) {
        console.error('[review] submit failed:', err);
      } finally {
        setSubmitting(false);
      }
    },
    [current, submitting, startTime],
  );

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
      <div className="text-muted-foreground flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!current) {
    return <SessionDone stats={stats} onReturn={() => router.back()} />;
  }

  const progress = queue.length > 0 ? ((idx + 1) / queue.length) * 100 : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-foreground/80 font-mono font-semibold tabular-nums">
            {idx + 1} <span className="text-text-muted font-normal">/ {queue.length}</span>
          </span>
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em]">
            {current.state}
          </span>
        </div>
        <div className="bg-muted relative h-1 overflow-hidden rounded-full">
          <div
            className="from-primary to-primary-hover duration-base ease-expo-out absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <Card className="border-divider bg-card shadow-soft duration-base hover:shadow-elevated overflow-hidden rounded-2xl transition-shadow">
        <div className="px-7 py-8">
          <CardFront card={current} revealed={revealed} />
        </div>

        {revealed && (
          <div className="border-divider bg-surface-secondary/50 animate-fade-in-up border-t px-7 py-7">
            <p className="text-primary mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
              Đáp án
            </p>
            <CardBack card={current} />
          </div>
        )}
      </Card>

      {!revealed ? (
        <Button
          onClick={() => setRevealed(true)}
          className="shadow-soft hover:shadow-glow w-full"
          size="lg"
        >
          Hiện đáp án
          <kbd className="bg-primary-foreground/15 ml-2 rounded px-1.5 py-0.5 font-mono text-[10px] tracking-tight">
            Space
          </kbd>
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-2.5">
          {RATINGS.map((r) => (
            <button
              key={r.rating}
              onClick={() => submitRating(r.rating)}
              disabled={submitting}
              className={`group/rate duration-base ease-expo-out flex flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-3 transition-all hover:-translate-y-0.5 active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${r.className}`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
                {r.short}
              </span>
              <span className="text-base font-semibold tracking-tight">{r.label}</span>
              <kbd className="bg-foreground/5 mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] opacity-60">
                {r.key}
              </kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CardFront({ card, revealed }: { card: Flashcard; revealed: boolean }) {
  if (card.cardType === 'CLOZE') {
    return <ClozeRenderer text={card.front} revealed={revealed} />;
  }
  if (card.cardType === 'IMAGE_OCCLUSION') {
    const masks = parseMasks(card.back);
    return <ImageOcclusionViewer imageUrl={card.front} masks={masks} revealed={revealed} />;
  }
  return <p className="whitespace-pre-wrap text-lg leading-relaxed">{card.front}</p>;
}

function CardBack({ card }: { card: Flashcard }) {
  if (card.cardType === 'CLOZE') {
    return (
      <p className="text-muted-foreground text-sm italic">
        Đáp án được tô sáng trong câu phía trên.
      </p>
    );
  }
  if (card.cardType === 'IMAGE_OCCLUSION') {
    return (
      <p className="text-muted-foreground text-sm italic">
        Vùng cần học đã được hiển thị trong ảnh.
      </p>
    );
  }
  return <p className="whitespace-pre-wrap text-base leading-relaxed">{card.back}</p>;
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
  onReturn,
}: {
  stats: { done: number; good: number };
  onReturn: () => void;
}) {
  const rate = stats.done > 0 ? Math.round((stats.good / stats.done) * 100) : 0;
  return (
    <div className="mx-auto max-w-md space-y-4 py-12 text-center">
      <div className="text-4xl">🎉</div>
      <h2 className="text-2xl font-semibold">Xong session!</h2>
      <p className="text-muted-foreground">
        Đã ôn {stats.done} thẻ · retention session <strong>{rate}%</strong>
      </p>
      <Button onClick={onReturn} variant="outline">
        <RotateCcw className="mr-2 h-4 w-4" />
        Về danh sách
      </Button>
    </div>
  );
}
