/**
 * Citation badge — superscript clickable hiển thị nguồn `[N]` inline trong
 * câu trả lời AI. Hover/click → popover với snippet chunk + filename + page.
 *
 * Kiểu hiển thị giống cách Anthropic Claude.ai và NotebookLM dùng — số
 * superscript có nền primary để dễ thấy nhưng không phá nhịp đọc.
 */
'use client';

import { ExternalLink, FileText } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type CitationData = {
  /** 1-indexed số citation tương ứng với [N] trong response. */
  n: number;
  chunkId: string;
  documentId: string;
  filename: string;
  page: number | null;
  score: number;
  /** Snippet ngắn (~240 ký tự) để show trong popover. */
  snippet: string;
};

type Props = {
  /** Mảng số citation, ví dụ "[1,2]" → numbers = [1,2]. */
  numbers: number[];
  /** Map đầy đủ citation theo n từ message annotation. */
  citations: CitationData[];
  /**
   * Callback khi user click "Xem trong chat" — open inline side panel thay vì
   * navigate sang /documents/[id]. Nếu undefined, fallback link `<a href>`.
   */
  onOpenDocPreview?: (citation: CitationData) => void;
};

export function CitationBadge({ numbers, citations, onOpenDocPreview }: Props) {
  // Filter ra citation match với numbers; nếu không có (ví dụ Claude
  // hallucinate ref) thì hiển thị nguyên text [N] không clickable.
  const matched = numbers
    .map((n) => citations.find((c) => c.n === n))
    .filter((c): c is CitationData => c !== undefined);
  if (matched.length === 0) {
    return <sup className="text-muted-foreground">[{numbers.join(',')}]</sup>;
  }

  // Single citation + callback: click thẳng vào số → open inline panel (skip
  // popover). Nhanh hơn cho UX phổ biến.
  if (matched.length === 1 && onOpenDocPreview) {
    const c = matched[0]!;
    return (
      <button
        type="button"
        onClick={() => onOpenDocPreview(c)}
        title={`${c.filename}${c.page ? ` · trang ${c.page}` : ''}`}
        className={cn(
          'mx-0.5 inline-flex cursor-pointer items-center rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary align-super',
          'hover:bg-primary/20 transition-colors',
        )}
      >
        [{numbers.join(',')}]
      </button>
    );
  }

  // Multi-citation `[1,2]` hoặc không có callback → giữ popover để user chọn.
  return (
    <Popover>
      <PopoverTrigger asChild>
        <sup
          className={cn(
            'mx-0.5 inline-flex cursor-pointer items-center rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary',
            'hover:bg-primary/20 transition-colors',
          )}
        >
          [{numbers.join(',')}]
        </sup>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[90vw] p-3">
        <div className="space-y-3">
          {matched.map((c) => (
            <div key={c.chunkId} className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{c.filename}</span>
                {c.page && (
                  <span className="text-muted-foreground">trang {c.page}</span>
                )}
                <span className="ml-auto text-muted-foreground">
                  {(c.score * 100).toFixed(0)}%
                </span>
              </div>
              <p className="line-clamp-4 text-xs text-muted-foreground">{c.snippet}</p>
              <div className="flex items-center gap-3">
                {onOpenDocPreview && (
                  <button
                    type="button"
                    onClick={() => onOpenDocPreview(c)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Xem cạnh chat
                  </button>
                )}
                <a
                  href={`/documents/${c.documentId}${c.page ? `#page-${c.page}` : ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  Mở trang mới
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
