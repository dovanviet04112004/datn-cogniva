/**
 * ClozeRenderer — hiển thị câu cloze trong review.
 *
 * Props:
 *   - text: cloze text gốc `"... {{c1::keyword}} ..."`
 *   - revealedIndex: cloze nào đang được tiết lộ (0 = ẩn tất cả ở front,
 *     showIndex > 0 ở back = reveal 1 cụm)
 *
 * Phase 5 v1: chỉ render 1 cloze/card (index 1). Multi-cloze trong 1 text
 * vẫn parse được nhưng UI ẩn tất c1 cùng nhau. Đủ cho 90% case.
 */
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

  // Cloze span: nếu revealed → show answer (highlight); chưa → show placeholder
  if (revealed) {
    return (
      <span
        key={i}
        className="rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary"
      >
        {seg.answer}
      </span>
    );
  }
  return (
    <span
      key={i}
      className={cn(
        'inline-block min-w-[80px] rounded bg-muted px-1.5 py-0.5 text-center font-medium text-muted-foreground',
      )}
    >
      {seg.hint ? `[${seg.hint}]` : '[...]'}
    </span>
  );
}
