/**
 * RichContent — parse message content thành React node:
 *   - `[label](/documents/X)` → DocCard (fetch title từ API)
 *   - `[label](/flashcards/X)` → FlashcardCard
 *   - `[label](/exams/X)`     → ExamCard với leaderboard link
 *   - `[label](/graph?concept=X)` → ConceptPill
 *   - `[[Concept Name]]`      → ConceptPill (inline, parse name → link /graph?q=)
 *   - URL bình thường         → link external
 *   - text                    → plain
 *
 * Strategy: regex split content thành tokens, render từng token.
 * Cogniva cards render compact với icon + title + nút mở.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText, BrainCircuit, ClipboardList, Network, ExternalLink } from 'lucide-react';

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'doc'; id: string; label: string }
  | { kind: 'flashcard'; id: string; label: string }
  | { kind: 'exam'; id: string; label: string }
  | { kind: 'concept-url'; query: string; label: string }
  | { kind: 'concept-wiki'; name: string }
  | { kind: 'extern'; url: string; label: string };

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const WIKI_RE = /\[\[([^\]]+)\]\]/g;

function tokenize(content: string): Token[] {
  // 2-pass: 1st extract markdown links, 2nd extract [[wiki]] in plain segments
  const out: Token[] = [];
  let last = 0;
  for (const m of content.matchAll(LINK_RE)) {
    if (m.index !== undefined && m.index > last) {
      pushTextWithWiki(out, content.slice(last, m.index));
    }
    const label = m[1] ?? '';
    const url = m[2] ?? '';
    out.push(classifyUrl(url, label));
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < content.length) {
    pushTextWithWiki(out, content.slice(last));
  }
  return out;
}

function pushTextWithWiki(out: Token[], text: string) {
  let last = 0;
  for (const m of text.matchAll(WIKI_RE)) {
    if (m.index !== undefined && m.index > last) {
      out.push({ kind: 'text', value: text.slice(last, m.index) });
    }
    out.push({ kind: 'concept-wiki', name: m[1] ?? '' });
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < text.length) {
    out.push({ kind: 'text', value: text.slice(last) });
  }
}

function classifyUrl(url: string, label: string): Token {
  const m1 = url.match(/^\/documents\/([\w-]+)/);
  if (m1) return { kind: 'doc', id: m1[1]!, label };
  const m2 = url.match(/^\/flashcards\/([\w-]+)/);
  if (m2) return { kind: 'flashcard', id: m2[1]!, label };
  const m3 = url.match(/^\/exams\/([\w-]+)/);
  if (m3) return { kind: 'exam', id: m3[1]!, label };
  const m4 = url.match(/^\/graph\?(?:q|concept)=([^&]+)/);
  if (m4) return { kind: 'concept-url', query: decodeURIComponent(m4[1]!), label };
  return { kind: 'extern', url, label };
}

export function RichContent({ content }: { content: string }) {
  const tokens = React.useMemo(() => tokenize(content), [content]);

  // Có inline token (text/wiki/extern) vs block token (doc/flashcard/exam card)
  const inline: Token[] = [];
  const blocks: Token[] = [];
  for (const t of tokens) {
    if (t.kind === 'doc' || t.kind === 'flashcard' || t.kind === 'exam') {
      blocks.push(t);
    } else {
      inline.push(t);
    }
  }

  return (
    <>
      {inline.length > 0 && (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {inline.map((t, i) => (
            <InlineToken key={i} token={t} />
          ))}
        </p>
      )}
      {blocks.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          {blocks.map((t, i) => (
            <BlockCard key={i} token={t} />
          ))}
        </div>
      )}
    </>
  );
}

function InlineToken({ token }: { token: Token }) {
  switch (token.kind) {
    case 'text':
      return <>{token.value}</>;
    case 'concept-wiki':
      return (
        <Link
          href={`/graph?q=${encodeURIComponent(token.name)}`}
          className="mx-0.5 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary hover:bg-primary/20"
        >
          <Network className="h-3 w-3" />
          {token.name}
        </Link>
      );
    case 'concept-url':
      return (
        <Link
          href={`/graph?q=${encodeURIComponent(token.query)}`}
          className="mx-0.5 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary hover:bg-primary/20"
        >
          <Network className="h-3 w-3" />
          {token.label || token.query}
        </Link>
      );
    case 'extern':
      return (
        <a
          href={token.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-primary underline hover:text-primary/80"
        >
          {token.label}
          <ExternalLink className="h-3 w-3" />
        </a>
      );
    default:
      return null;
  }
}

function BlockCard({ token }: { token: Token }) {
  if (token.kind === 'doc') {
    return (
      <Link
        href={`/documents/${token.id}`}
        className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent/50"
      >
        <FileText className="h-4 w-4 shrink-0 text-blue-500" />
        <span className="min-w-0 flex-1 truncate font-medium">{token.label}</span>
        <span className="text-[10px] text-muted-foreground">Document</span>
      </Link>
    );
  }
  if (token.kind === 'flashcard') {
    return (
      <Link
        href={`/flashcards/${token.id}`}
        className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent/50"
      >
        <BrainCircuit className="h-4 w-4 shrink-0 text-purple-500" />
        <span className="min-w-0 flex-1 truncate font-medium">{token.label}</span>
        <span className="text-[10px] text-muted-foreground">Flashcard</span>
      </Link>
    );
  }
  if (token.kind === 'exam') {
    return (
      <Link
        href={`/exams/${token.id}`}
        className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent/50"
      >
        <ClipboardList className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate font-medium">{token.label}</span>
        <span className="text-[10px] text-muted-foreground">Exam</span>
      </Link>
    );
  }
  return null;
}
