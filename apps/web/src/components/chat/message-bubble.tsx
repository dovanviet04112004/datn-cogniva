/**
 * MessageBubble — 1 dòng tin nhắn trong chat. Bố cục khác nhau cho user
 * vs assistant: user căn phải, nền secondary; assistant căn trái, nền
 * card với markdown rendering + citation.
 */
'use client';

import { Bot, User } from 'lucide-react';

import { cn } from '@/lib/utils';

import { type CitationData } from './citation';
import { MarkdownMessage } from './markdown-message';
import { TtsButton } from './tts-button';

export type ChatRole = 'user' | 'assistant' | 'system';

type Props = {
  role: ChatRole;
  content: string;
  citations: CitationData[];
  /** Tin nhắn đang stream — render với cursor đang gõ. */
  isStreaming?: boolean;
};

export function MessageBubble({ role, content, citations, isStreaming }: Props) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex w-full gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar nhỏ — bot dùng icon, user vẫn icon (avatar thật ở topbar) */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
          isUser ? 'bg-secondary' : 'bg-primary text-primary-foreground',
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div
        className={cn(
          'min-w-0 flex-1 rounded-lg px-4 py-3',
          isUser
            ? 'max-w-[80%] bg-secondary text-secondary-foreground'
            : 'bg-muted/30',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        ) : (
          <>
            <MarkdownMessage content={content} citations={citations} />
            {/* TTS button — chỉ hiện khi đã stream xong + có content */}
            {!isStreaming && content.trim() && (
              <div className="mt-1 flex justify-end">
                <TtsButton text={content} />
              </div>
            )}
          </>
        )}
        {isStreaming && (
          <span
            className="ml-1 inline-block h-3 w-1 animate-pulse bg-foreground/60 align-middle"
            aria-label="đang gõ"
          />
        )}
      </div>
    </div>
  );
}
