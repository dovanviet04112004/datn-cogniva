'use client';

import { parseCloze, type ClozeSegment } from '@/lib/flashcards/cloze';
import { cn } from '@/lib/utils';

type Props = {
  text: string;
  revealed: boolean;
};

export function ClozeRenderer({ text, revealed }: Props) {
  const segments = parseCloze(text);

  return (
    <p className="text-lg leading-relaxed">
      {segments.map((seg, i) => renderSegment(seg, i, revealed))}
    </p>
  );
}

function renderSegment(seg: ClozeSegment, i: number, revealed: boolean) {
  if (seg.type === 'text') return <span key={i}>{seg.content}</span>;

  if (revealed) {
    return (
      <span key={i} className="bg-primary/15 text-primary rounded px-1.5 py-0.5 font-semibold">
        {seg.answer}
      </span>
    );
  }
  return (
    <span
      key={i}
      className={cn(
        'bg-muted text-muted-foreground inline-block min-w-[80px] rounded px-1.5 py-0.5 text-center font-medium',
      )}
    >
      {seg.hint ? `[${seg.hint}]` : '[...]'}
    </span>
  );
}
