/**
 * MarkdownMessage — render Markdown response của AI có hỗ trợ citation
 * inline `[N]` thành `<CitationBadge>` clickable.
 *
 * Cách hoạt động:
 *   1. react-markdown + remark-gfm dựng AST cho text Markdown.
 *   2. Override component `p` và `li` để bắt children string, regex split
 *      `[N]` hoặc `[N,M]` thành CitationBadge component.
 *   3. Citation BÊN TRONG bold/code/heading sẽ KHÔNG được wrap (acceptable
 *      cho Phase 2 — Claude hiếm khi đặt citation trong các vùng đó).
 *
 * Phase 3 cải tiến: viết remark plugin custom để wrap citation ở mọi vị trí
 * trong AST (bao gồm inside emphasis/strong/code).
 */
'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CitationBadge, type CitationData } from './citation';

type Props = {
  content: string;
  citations: CitationData[];
};

// Match cả ASCII `[1]` lẫn CJK `【1】` — model trả lời tiếng Việt thi
// thoảng dùng bracket Trung/Nhật theo thói quen formal text.
const CITATION_REGEX = /[\[【](\d+(?:\s*,\s*\d+)*)[\]】]/g;

/**
 * Walk children của 1 markdown element. Với mỗi text node, tìm `[N]` và
 * wrap thành CitationBadge. Các React element con giữ nguyên.
 */
function processChildren(
  children: React.ReactNode,
  citations: CitationData[],
): React.ReactNode {
  return React.Children.map(children, (child, idx) => {
    if (typeof child !== 'string') return child;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    CITATION_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CITATION_REGEX.exec(child)) !== null) {
      if (match.index > lastIndex) {
        parts.push(child.slice(lastIndex, match.index));
      }
      const numbers = match[1]!.split(',').map((s) => parseInt(s.trim(), 10));
      parts.push(
        <CitationBadge
          key={`${idx}-${match.index}`}
          numbers={numbers}
          citations={citations}
        />,
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < child.length) {
      parts.push(child.slice(lastIndex));
    }
    return parts.length === 0 ? child : <>{parts}</>;
  });
}

export function MarkdownMessage({ content, citations }: Props) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Override các element thường chứa text inline để wrap citation
          p: ({ children }) => <p>{processChildren(children, citations)}</p>,
          li: ({ children }) => <li>{processChildren(children, citations)}</li>,
          // Heading + blockquote ít khi có citation nhưng cũng wrap để chắc
          h1: ({ children }) => <h1>{processChildren(children, citations)}</h1>,
          h2: ({ children }) => <h2>{processChildren(children, citations)}</h2>,
          h3: ({ children }) => <h3>{processChildren(children, citations)}</h3>,
          blockquote: ({ children }) => (
            <blockquote>{processChildren(children, citations)}</blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
