/**
 * /flashcards — danh sách + stats + tạo thủ công + AI generate.
 *
 * Layout:
 *   1. StatsPanel (4 chỉ số)
 *   2. Actions row: "Ôn ngay" (link queue) + GenerateDialog + Toggle form
 *   3. FlashcardForm (collapsible) + list paginated
 *
 * Client component cho realtime refresh sau create/generate/delete.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Trash2, Play } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton-list';

import { FlashcardForm } from '@/components/flashcards/flashcard-form';
import { GenerateDialog } from '@/components/flashcards/generate-dialog';
import { StatsPanel } from '@/components/flashcards/stats-panel';

type Flashcard = {
  id: string;
  cardType: 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION';
  front: string;
  back: string;
  state: string;
  due: string;
};

export default function FlashcardsPage() {
  const [cards, setCards] = React.useState<Flashcard[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    fetch('/api/flashcards?limit=100')
      .then((r) => r.json())
      .then((d: { flashcards: Flashcard[] }) => setCards(d.flashcards))
      .finally(() => setLoading(false));
  }, [refresh]);

  const triggerRefresh = () => setRefresh((r) => r + 1);

  const deleteCard = async (id: string) => {
    try {
      const res = await fetch(`/api/flashcards/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setCards((cs) => cs.filter((c) => c.id !== id));
      toast.success('Đã xoá');
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Flashcards</h1>
        <p className="text-sm text-muted-foreground">
          Spaced repetition với thuật toán FSRS — học bền lâu hơn Anki SM-2.
        </p>
      </div>

      <StatsPanel key={refresh /* re-mount sau create */} />

      <div className="flex flex-wrap gap-2">
        <Link href="/flashcards/review">
          <Button size="lg">
            <Play className="mr-2 h-4 w-4" />
            Ôn ngay
          </Button>
        </Link>
        <GenerateDialog onGenerated={triggerRefresh} />
        <Button variant="outline" onClick={() => setShowForm((s) => !s)}>
          <Plus className="mr-2 h-4 w-4" />
          Tạo thủ công
        </Button>
      </div>

      {showForm && <FlashcardForm onCreated={triggerRefresh} />}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Danh sách ({cards.length})</h2>
        {loading && <SkeletonList rows={5} />}
        {!loading && cards.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            Chưa có thẻ nào. Bấm <strong>AI generate</strong> hoặc{' '}
            <strong>Tạo thủ công</strong> để bắt đầu.
          </Card>
        )}
        {cards.map((card) => (
          <Card key={card.id} className="flex items-start gap-3 p-3">
            <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase tracking-wider text-muted-foreground">
              {card.cardType}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {card.cardType === 'IMAGE_OCCLUSION' ? '🖼 Image occlusion' : card.front}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {card.cardType === 'CLOZE'
                  ? '(cloze auto)'
                  : card.cardType === 'IMAGE_OCCLUSION'
                    ? '(masks JSON)'
                    : card.back}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {card.state}
            </span>
            <button
              onClick={() => deleteCard(card.id)}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Xoá"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}
