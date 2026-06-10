/**
 * ChatDetailClient — minimal chat view cho /chat/[id] persisted conversation.
 *
 * V7 (2026-05-20): thay thế ChatInterface (875 dòng) sau khi xoá /chat/new
 * + ChatShell. Workspace chat là center; /chat/[id] chỉ là deep link view
 * cho conv cụ thể (vd shared URL, history).
 *
 * Render:
 *   - Top bar: title + "Mở trong workspace" link (nếu conv có workspaceId)
 *   - Message list (cùng style với V6 workspace ChatView)
 *   - Composer dưới (textarea + send)
 *
 * KHÔNG có: workspace pill, file attach, voice, context panel — defer hết.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useChat, type Message as AIMessage } from '@ai-sdk/react';
import { ArrowLeftRight, ArrowUp, Loader2, Square } from 'lucide-react';
import { toast } from 'sonner';

import { CitationRenderer, extractCitations } from './citation-renderer';
import { DocPreviewProvider } from './doc-preview-context';
import { DocPreviewPanel } from './doc-preview-panel';
import { cn } from '@/lib/utils';

type Conversation = {
  id: string;
  title: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
};

type Props = {
  conversation: Conversation;
  initialMessages: AIMessage[];
};

export function ChatDetailClient({ conversation, initialMessages }: Props) {
  // V8.7: citation click → DocPreviewPanel modal (portal ở body root) thay
  // vì right side panel. Single column chat layout.
  return (
    <DocPreviewProvider>
      <ChatDetailInner
        conversation={conversation}
        initialMessages={initialMessages}
      />
      <DocPreviewPanel />
    </DocPreviewProvider>
  );
}

function ChatDetailInner({ conversation, initialMessages }: Props) {
  const { messages, input, setInput, handleSubmit, status, stop } = useChat({
    api: '/api/chat',
    id: conversation.id,
    initialMessages,
    body: {
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId ?? undefined,
    },
    onError: (err) => toast.error(err.message ?? 'Chat lỗi'),
  });

  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const isLoading = status === 'streaming' || status === 'submitted';

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b bg-muted/20 px-4 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {conversation.title ?? 'Untitled conversation'}
            </h1>
            {conversation.workspaceName && (
              <p className="truncate text-[10.5px] text-muted-foreground">
                trong workspace · {conversation.workspaceName}
              </p>
            )}
          </div>
          {conversation.workspaceId && (
            <Link
              href={`/workspaces/${conversation.workspaceId}?view=chat`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              title="Mở workspace notebook (Sources · Chat · Studio)"
            >
              <ArrowLeftRight className="h-3 w-3" />
              Mở trong workspace
            </Link>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              role={m.role}
              content={m.content}
              annotations={m.annotations}
            />
          ))}
          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI đang suy nghĩ…
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t bg-background px-4 py-3" data-composer>
        <form
          onSubmit={(e) => {
            if (!input.trim() || isLoading) {
              e.preventDefault();
              return;
            }
            handleSubmit(e);
          }}
          className="mx-auto max-w-3xl"
        >
          <div className="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:border-foreground/30">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Hỏi tiếp… (⌘+Enter để gửi)"
              rows={2}
              className="block max-h-40 w-full resize-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {isLoading ? (
              <button
                type="button"
                onClick={() => stop()}
                aria-label="Dừng"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/80"
              >
                <Square className="h-3 w-3 fill-current" strokeWidth={0} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Gửi"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageItem({
  role,
  content,
  annotations,
}: {
  role: string;
  content: string;
  annotations?: unknown[];
}) {
  const isUser = role === 'user';
  const citations = isUser ? [] : extractCitations(annotations);
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
        ) : (
          <CitationRenderer content={content} citations={citations} />
        )}
      </div>
    </div>
  );
}
