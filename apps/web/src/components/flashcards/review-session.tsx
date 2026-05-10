/**
 * ReviewSession — UI ôn flashcards với keyboard 1-4 + mouse.
 *
 * Flow:
 *   1. Fetch /api/flashcards/queue → array cards
 *   2. Hiển thị card.front → user click "Hiện đáp án" hoặc bấm Space
 *   3. Reveal back → 4 button rating Again/Hard/Good/Easy (1/2/3/4)
 *   4. Submit POST /api/flashcards/[id]/review → next card
 *   5. Khi hết queue → màn hình tổng kết (số reviewed, % retention session)
 *
 * Render card theo cardType:
 *   - BASIC: text front + back
 *   - CLOZE: ClozeRenderer với revealed bool
 *   - IMAGE_OCCLUSION: ImageOcclusionViewer
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw } from 'lucide-react';

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
};

const RATINGS = [
  { rating: 1, label: 'Lại', short: 'Again', key: '1', className: 'bg-red-500/15 hover:bg-red-500/25 text-red-200' },
  { rating: 2, label: 'Khó', short: 'Hard', key: '2', className: 'bg-orange-500/15 hover:bg-orange-500/25 text-orange-200' },
  { rating: 3, label: 'Tốt', short: 'Good', key: '3', className: 'bg-green-500/15 hover:bg-green-500/25 text-green-200' },
  { rating: 4, label: 'Dễ', short: 'Easy', key: '4', className: 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-200' },
];

export function ReviewSession({ initial }: Props) {
  const router = useRouter();
  const [queue, setQueue] = React.useState<Flashcard[]>(initial ?? []);
  const [idx, setIdx] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [startTime, setStartTime] = React.useState(Date.now());
  const [stats, setStats] = React.useState({ done: 0, good: 0 });
  const [loading, setLoading] = React.useState(!initial);

  React.useEffect(() => {
    if (initial) return;
    fetch('/api/flashcards/queue')
      .then((r) => r.json())
      .then((d) => setQueue(d.flashcards))
      .finally(() => setLoading(false));
  }, [initial]);

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
        await fetch(`/api/flashcards/${current.id}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating, duration }),
        });
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

  // Keyboard shortcuts: Space = reveal, 1-4 = rating
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
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!current) {
    return <SessionDone stats={stats} onReturn={() => router.push('/flashcards')} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {idx + 1} / {queue.length}
        </span>
        <span className="text-xs uppercase tracking-wider">{current.state}</span>
      </div>

      <Card className="overflow-hidden">
        {/* Front */}
        <div className="border-b p-6">
          <CardFront card={current} revealed={revealed} />
        </div>

        {/* Back — chỉ hiện khi revealed */}
        {revealed && (
          <div className="bg-muted/30 p-6">
            <CardBack card={current} />
          </div>
        )}
      </Card>

      {/* Actions */}
      {!revealed ? (
        <Button onClick={() => setRevealed(true)} className="w-full" size="lg">
          Hiện đáp án (Space)
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {RATINGS.map((r) => (
            <button
              key={r.rating}
              onClick={() => submitRating(r.rating)}
              disabled={submitting}
              className={`flex flex-col items-center justify-center rounded-md py-3 transition-colors disabled:opacity-50 ${r.className}`}
            >
              <span className="text-xs uppercase opacity-70">{r.short}</span>
              <span className="text-base font-semibold">{r.label}</span>
              <span className="mt-0.5 text-[10px] opacity-60">phím {r.key}</span>
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
    // front field lưu URL ảnh dạng "/api/flashcards/image/..."
    return <ImageOcclusionViewer imageUrl={card.front} masks={masks} revealed={revealed} />;
  }
  return <p className="whitespace-pre-wrap text-lg leading-relaxed">{card.front}</p>;
}

function CardBack({ card }: { card: Flashcard }) {
  if (card.cardType === 'CLOZE') {
    // Cloze back tự sinh — chỉ note "Đã hiện đáp án phía trên"
    return (
      <p className="text-sm italic text-muted-foreground">
        Đáp án được tô sáng trong câu phía trên.
      </p>
    );
  }
  if (card.cardType === 'IMAGE_OCCLUSION') {
    return (
      <p className="text-sm italic text-muted-foreground">
        Vùng cần học đã được hiển thị trong ảnh.
      </p>
    );
  }
  return <p className="whitespace-pre-wrap text-base leading-relaxed">{card.back}</p>;
}

/** Parse IMAGE_OCCLUSION back field — kỳ vọng JSON masks. */
function parseMasks(raw: string): Mask[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.masks)) return parsed.masks as Mask[];
    return [];
  } catch {
    return [];
  }
}

function SessionDone({ stats, onReturn }: { stats: { done: number; good: number }; onReturn: () => void }) {
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
