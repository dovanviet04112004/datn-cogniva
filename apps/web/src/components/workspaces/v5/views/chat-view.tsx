/**
 * ChatView — default view ở main panel V5/V6 notebook.
 *
 * Spec: docs/plans/v5-notebooklm-layout.md §4.2 + V6 multi-conversation.
 *
 * V6 (2026-05-20): 1 workspace có thể có nhiều conversation (giống
 * NotebookLM). Top bar có dropdown switcher + button "Mới". Default: chọn
 * conv gần nhất; nếu chưa có thì ephemeral mới.
 *
 * Khác /chat full page:
 *   - Scope tự động: workspaceId + selectedDocs + selectedAtoms từ Sources
 *   - Không có file attach (V5.2+ thêm sau nếu cần)
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useChat, type Message as AIMessage } from '@ai-sdk/react';
import {
  ArrowUp,
  ChevronDown,
  ExternalLink,
  Loader2,
  MessageSquarePlus,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CitationRenderer,
  extractCitations,
} from '@/components/chat/citation-renderer';
import { cn } from '@/lib/utils';
import { useNotebook } from '../notebook-context';

type Conversation = {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  messageCount: number;
};

type Props = {
  workspaceId: string;
  workspaceName: string;
};

/**
 * V8.19 (2026-05-20): ChatGPT pattern — pure URL, không cookie/localStorage.
 *   - `?conv=<id>` = load conv cụ thể
 *   - không có  `?conv` = new chat mode (default)
 *
 * Behavior:
 *   - Reload: URL preserved → conv preserved ✓
 *   - Navigate away + back via bare URL → new chat (predictable, simple)
 *   - User pick conv từ switcher dropdown để mở conv cũ
 *   - Không auto-select "conv gần nhất" → tránh surprise jump
 *
 * Tránh client-side state (localStorage/sessionStorage/cookie restore) — URL
 * là source of truth tuyệt đối, giống ChatGPT/Claude.
 */
export function ChatView({ workspaceId, workspaceName }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /** Null = new chat mode. String = load conv đó. */
  const urlConvId = searchParams.get('conv');

  const qc = useQueryClient();
  const [initialMessages, setInitialMessages] = React.useState<AIMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = React.useState(false);
  /** sessionKey để remount ChatBody khi switch conv (reset useChat state). */
  const [sessionKey, setSessionKey] = React.useState(0);

  /** URL helper: replace với conv mới (hoặc null = xoá param = new chat). */
  const replaceConvUrl = React.useCallback(
    (convId: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (convId) next.set('conv', convId);
      else next.delete('conv');
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Conversation list qua React Query — cache theo workspace, refetch sau khi
  // tạo conv mới (invalidate). Messages + streaming vẫn để AI SDK lo riêng.
  const { data: convData } = useQuery({
    queryKey: qk.workspaceConversations(workspaceId),
    queryFn: () =>
      apiGet<{ conversations: Conversation[] }>(
        `/api/workspaces/${workspaceId}/conversations`,
      ).then((d) => d.conversations),
  });
  const conversations = convData ?? [];
  const refreshConversations = React.useCallback(
    () => qc.invalidateQueries({ queryKey: qk.workspaceConversations(workspaceId) }),
    [qc, workspaceId],
  );

  // V8.x FIX vòng lặp vô hạn: callback PHẢI stable (useCallback). Trước đây truyền
  // arrow inline → mỗi render đổi reference → effect "conv created" trong ChatBody
  // (deps có callback này) re-fire → replaceConvUrl đổi URL → re-render → lặp →
  // spam /conversations + router.replace liên tục → sập. Stable ref + guard ở
  // ChatBody chặn lặp.
  const handleConversationCreated = React.useCallback(
    (newId: string) => {
      replaceConvUrl(newId);
      void refreshConversations();
    },
    [replaceConvUrl, refreshConversations],
  );

  // Fetch messages mỗi khi urlConvId đổi (user switch / URL change / load)
  React.useEffect(() => {
    if (!urlConvId) {
      setInitialMessages([]);
      setSessionKey((k) => k + 1);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    fetch(`/api/conversations/${urlConvId}/messages`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return (await r.json()) as { messages: AIMessage[] };
      })
      .then((d) => {
        if (cancelled) return;
        setInitialMessages(d.messages);
        setSessionKey((k) => k + 1);
      })
      .catch((err) => {
        if (!cancelled)
          toast.error('Load conversation lỗi: ' + (err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urlConvId]);

  /** Switch sang 1 conv = đổi URL. messages fetch tự chạy qua effect ở trên. */
  const selectConversation = React.useCallback(
    (convId: string | null) => {
      if (convId === urlConvId) return;
      // V8.19: null → xoá param (new chat). String → set conv id.
      replaceConvUrl(convId);
    },
    [urlConvId, replaceConvUrl],
  );

  /** activeConvId derived từ URL — không state riêng để không lệch nhau. */
  const activeConvId = urlConvId;

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  return (
    <div className="flex h-full flex-col">
      {/* Top strip: conversation switcher + scope */}
      <ConversationSwitcher
        conversations={conversations}
        activeConv={activeConv}
        workspaceName={workspaceName}
        workspaceId={workspaceId}
        onSelect={selectConversation}
        onNew={() => selectConversation(null)}
      />

      {/* ChatBody remount khi sessionKey đổi (switch conv) */}
      {loadingMessages ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ChatBody
          key={sessionKey}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          conversationId={activeConvId}
          initialMessages={initialMessages}
          onConversationCreated={handleConversationCreated}
        />
      )}
    </div>
  );
}

function ConversationSwitcher({
  conversations,
  activeConv,
  workspaceName,
  workspaceId,
  onSelect,
  onNew,
}: {
  conversations: Conversation[];
  activeConv: Conversation | null;
  workspaceName: string;
  workspaceId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { selectedDocs, selectedAtoms } = useNotebook();
  const scopeHint =
    selectedDocs.size === 0 && selectedAtoms.size === 0
      ? 'Toàn workspace'
      : `${selectedDocs.size} doc · ${selectedAtoms.size} atom`;

  const currentTitle =
    activeConv?.title ??
    (activeConv ? 'Untitled' : 'Hội thoại mới');

  return (
    <header className="shrink-0 border-b bg-muted/20 px-3 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 max-w-[260px] items-center gap-1 rounded-md border bg-card px-2 text-xs font-medium hover:bg-muted"
                title="Chọn hội thoại"
                // V8.16: Radix auto-id mismatch SSR↔CSR sau khi auto-select
                // conv setState trong useEffect → tree shift → useId offset.
                // Suppress để dev overlay không spam.
                suppressHydrationWarning
              >
                <span className="truncate">{currentTitle}</span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider">
                Hội thoại trong {workspaceName}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onNew} className="gap-2">
                <MessageSquarePlus className="h-3.5 w-3.5" />
                <span>Hội thoại mới</span>
              </DropdownMenuItem>
              {conversations.length > 0 && <DropdownMenuSeparator />}
              {conversations.slice(0, 20).map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={() => onSelect(c.id)}
                  className={cn(
                    'flex flex-col items-start gap-0.5 py-1.5',
                    c.id === activeConv?.id && 'bg-primary/5 font-semibold text-primary',
                  )}
                >
                  <span className="line-clamp-1 w-full text-xs">
                    {c.title ?? 'Untitled'}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {c.messageCount} message ·{' '}
                    {formatRelative(c.lastMessageAt ?? c.createdAt)}
                  </span>
                </DropdownMenuItem>
              ))}
              {conversations.length === 0 && (
                <DropdownMenuItem disabled className="text-[11px] text-muted-foreground">
                  Chưa có hội thoại
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={onNew}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Hội thoại mới"
            title="Hội thoại mới"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            Scope: {scopeHint}
          </span>
          {activeConv && (
            <Link
              href={`/chat/${activeConv.id}`}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-primary"
              title="Mở full chat page (separate route)"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Full
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function ChatBody({
  workspaceId,
  workspaceName,
  conversationId,
  initialMessages,
  onConversationCreated,
}: {
  workspaceId: string;
  workspaceName: string;
  conversationId: string | null;
  initialMessages: AIMessage[];
  onConversationCreated: (id: string) => void;
}) {
  const { selectedDocs, selectedAtoms } = useNotebook();

  const docIds = React.useMemo(() => Array.from(selectedDocs), [selectedDocs]);
  const atomIds = React.useMemo(() => Array.from(selectedAtoms), [selectedAtoms]);

  const { messages, input, setInput, handleSubmit, status, stop, data } = useChat({
    api: '/api/chat',
    id: conversationId ?? undefined,
    initialMessages,
    body: {
      workspaceId,
      conversationId: conversationId ?? null,
      documentIds: docIds.length > 0 ? docIds : undefined,
      atomIds: atomIds.length > 0 ? atomIds : undefined,
    },
    onError: (err) => toast.error(err.message ?? 'Chat lỗi'),
  });

  // Capture conversationId từ server data stream khi tạo conv mới.
  // Guard `handledRef`: CHỈ xử lý 1 lần / lần mount (ChatBody remount theo
  // sessionKey khi switch conv nên ref tự reset). Chặn re-fire khi effect chạy
  // lại (vd callback đổi ref / data đổi) → không lặp vô hạn replaceConvUrl.
  const handledConvRef = React.useRef(false);
  React.useEffect(() => {
    if (conversationId || handledConvRef.current) return;
    const meta = (data ?? []).find(
      (d): d is { type: 'meta'; conversationId: string } =>
        typeof d === 'object' && d !== null && (d as { type?: string }).type === 'meta',
    );
    if (meta?.conversationId) {
      handledConvRef.current = true;
      onConversationCreated(meta.conversationId);
    }
  }, [data, conversationId, onConversationCreated]);

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
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState workspaceName={workspaceName} onPickPrompt={setInput} />
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
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
        )}
      </div>

      <div className="shrink-0 border-t bg-background px-4 py-3">
        <form
          onSubmit={(e) => {
            if (!input.trim() || isLoading) {
              e.preventDefault();
              return;
            }
            handleSubmit(e);
          }}
          className="mx-auto max-w-5xl"
        >
          <div className="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:border-foreground/30">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Hỏi gì về ${workspaceName}…  (⌘+Enter để gửi)`}
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
    </>
  );
}

const SUGGESTED_PROMPTS = [
  'Tóm tắt các tài liệu đã chọn — 5 ý chính',
  'Atom nào quan trọng nhất tôi cần học?',
  'So sánh 2 concept khác nhau trong sources',
  'Tạo 5 câu quiz từ tài liệu này',
];

function EmptyState({
  workspaceName,
  onPickPrompt,
}: {
  workspaceName: string;
  onPickPrompt: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 py-8 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">
        Chat với {workspaceName}
      </h2>
      <p className="text-sm text-muted-foreground">
        Hỏi bất kỳ điều gì về docs / atoms đã chọn ở Sources. Hoặc bấm 1 recipe ở
        Studio để bắt đầu phiên học.
      </p>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPickPrompt(p)}
            className="rounded-lg border bg-card p-3 text-left text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            {p}
          </button>
        ))}
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

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes}p trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return d.toLocaleDateString('vi-VN');
}
