/**
 * CitationRenderer — render message content có chứa marker `[N]` thành
 * text + clickable citation badge.
 *
 * V8 (2026-05-20). LLM sinh assistant response với marker `[1]`, `[2]` …
 * trỏ tới chunk được retrieve. Server gửi citations qua message annotation
 * `{ type: 'citations', citations: [{n, chunkId, documentId, filename, page, ...}] }`.
 *
 * Behavior:
 *   - Parse content split `[N]` markers
 *   - Mỗi marker → CitationBadge với Popover (KHÔNG mở tab mới)
 *   - Popover content: filename + page + full snippet + "Mở document"
 *     button (Next Link, client-side navigate same window)
 *
 * Dùng chung cho workspace chat (ChatView) + /chat/[id] (ChatDetailClient).
 */
'use client';

import * as React from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import { useDocPreview } from './doc-preview-context';

export type CitationData = {
  n: number;
  chunkId: string;
  documentId: string;
  filename: string;
  page: number | null;
  score: number;
  snippet: string;
};

/** Extract citations từ AI SDK message annotation. */
export function extractCitations(
  annotations: unknown[] | undefined,
): CitationData[] {
  if (!Array.isArray(annotations)) return [];
  for (const ann of annotations) {
    if (
      typeof ann === 'object' &&
      ann !== null &&
      (ann as { type?: string }).type === 'citations'
    ) {
      const list = (ann as { citations?: unknown }).citations;
      if (Array.isArray(list)) return list as CitationData[];
    }
  }
  return [];
}

type Props = {
  content: string;
  citations: CitationData[];
  className?: string;
};

export function CitationRenderer({ content, citations, className }: Props) {
  // Split theo `[N]` — group `(\[\d+\])` giữ marker trong kết quả split
  const parts = React.useMemo(() => content.split(/(\[\d+\])/g), [content]);

  return (
    <p className={cn('whitespace-pre-wrap leading-relaxed', className)}>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (!match) return <React.Fragment key={i}>{part}</React.Fragment>;
        const n = parseInt(match[1]!, 10);
        const citation = citations[n - 1];
        if (!citation || !citation.documentId) {
          return <React.Fragment key={i}>{part}</React.Fragment>;
        }
        return <CitationBadge key={i} n={n} citation={citation} />;
      })}
    </p>
  );
}

function CitationBadge({ n, citation }: { n: number; citation: CitationData }) {
  const docPreview = useDocPreview();

  const baseClass =
    'mx-0.5 inline-flex h-[1.1em] min-w-[1.1em] items-center justify-center rounded bg-primary/15 px-1 align-baseline font-mono text-[0.7em] font-semibold text-primary no-underline transition-colors hover:bg-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40';

  // Khi có DocPreviewProvider (workspace chat / chat detail) → click mở
  // panel sticky bên phải. Fallback: dùng Next Link navigate.
  if (docPreview) {
    return (
      <button
        type="button"
        onClick={() => docPreview.openCitation(citation)}
        className={cn(baseClass, 'cursor-pointer')}
        aria-label={`Citation ${n}: ${citation.filename}`}
        title={`${citation.filename}${citation.page ? ` · trang ${citation.page}` : ''}`}
      >
        {n}
      </button>
    );
  }

  const href = `/documents/${citation.documentId}${
    citation.page ? `#page-${citation.page}` : ''
  }`;
  return (
    <Link
      href={href}
      className={baseClass}
      aria-label={`Citation ${n}: ${citation.filename}`}
      title={`${citation.filename}${citation.page ? ` · trang ${citation.page}` : ''}`}
    >
      {n}
    </Link>
  );
}
