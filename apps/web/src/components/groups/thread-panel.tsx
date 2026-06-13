'use client';

import * as React from 'react';
import { Check, CheckCircle2, X, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useRealtimeEvent } from '@/lib/realtime-client';
import { can, type GroupRole } from '@/lib/group/permissions';
import { useMe } from '@/lib/use-me';

import type { Message } from './message-item';

type ThreadData = { root: Message; replies: Message[] };

type Props = {
  channelId: string;
  rootMessageId: string;
  onClose: () => void;
  forumContext?: {
    currentUserId: string;
    myRole: GroupRole;
  };
};

export function ThreadPanel({ channelId, rootMessageId, onClose, forumContext }: Props) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [content, setContent] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const {
    data: threadData,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: qk.thread(channelId, rootMessageId),
    queryFn: () =>
      apiGet<ThreadData>(`/api/channels/${channelId}/messages/${rootMessageId}/thread`),
    refetchOnMount: 'always',
  });
  const root = threadData?.root ?? null;
  const replies = threadData?.replies ?? [];

  React.useEffect(() => {
    if (error) toast.error('Không tải được thread');
  }, [error]);

  React.useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [replies.length]);

  const onReply = React.useCallback(
    (data: { id: string; threadRootId: string } & Partial<Message>) => {
      if (data.threadRootId !== rootMessageId) return;
      qc.setQueryData<ThreadData>(qk.thread(channelId, rootMessageId), (old) => {
        if (!old) return old;
        if (old.replies.some((x) => x.id === data.id)) return old;
        const m: Message = {
          id: data.id,
          channelId,
          authorId: data.authorId ?? '',
          authorName: data.authorName ?? null,
          authorImage: data.authorImage ?? null,
          content: data.content ?? '',
          contentType: 'markdown',
          replyToId: null,
          attachments: data.attachments ?? null,
          reactions: null,
          mentions: null,
          pinned: false,
          editedAt: null,
          deletedAt: null,
          createdAt: data.createdAt ?? new Date().toISOString(),
        };
        return { ...old, replies: [...old.replies, m] };
      });
    },
    [rootMessageId, channelId, qc],
  );
  useRealtimeEvent(`private-channel-${channelId}`, 'thread:new-reply', onReply);

  const onSolution = React.useCallback(
    (data: { messageId: string; threadRootId: string; isSolution: boolean }) => {
      if (data.threadRootId !== rootMessageId) return;
      qc.setQueryData<ThreadData>(qk.thread(channelId, rootMessageId), (old) =>
        old
          ? {
              ...old,
              replies: old.replies.map((r) => ({
                ...r,
                isSolution:
                  r.id === data.messageId
                    ? data.isSolution
                    : data.isSolution
                      ? false
                      : r.isSolution,
              })),
            }
          : old,
      );
    },
    [rootMessageId, channelId, qc],
  );
  useRealtimeEvent(`private-channel-${channelId}`, 'forum:solution', onSolution);

  const isPostAuthor = !!forumContext && root?.authorId === forumContext.currentUserId;
  const canMarkSolution =
    !!forumContext && (isPostAuthor || can(forumContext.myRole, 'message.delete-any'));

  const toggleSolution = React.useCallback(
    async (msg: Message) => {
      const next = !msg.isSolution;
      const key = qk.thread(channelId, rootMessageId);
      qc.setQueryData<ThreadData>(key, (old) =>
        old
          ? {
              ...old,
              replies: old.replies.map((r) => ({
                ...r,
                isSolution: r.id === msg.id ? next : next ? false : r.isSolution,
              })),
            }
          : old,
      );
      try {
        await apiSend(`/api/channels/${channelId}/messages/${msg.id}/solution`, 'POST', {
          mark: next,
        });
      } catch (err) {
        toast.error('Đánh dấu solution lỗi: ' + (err as Error).message);
        void qc.invalidateQueries({ queryKey: key });
      }
    },
    [channelId, rootMessageId, qc],
  );

  const send = async () => {
    const text = content.trim();
    if (!text) return;
    const key = qk.thread(channelId, rootMessageId);
    setContent('');

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: tempId,
      channelId,
      authorId: me?.id ?? '',
      authorName: me?.name ?? null,
      authorImage: me?.image ?? null,
      content: text,
      contentType: 'markdown',
      replyToId: null,
      attachments: null,
      reactions: null,
      mentions: null,
      pinned: false,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    qc.setQueryData<ThreadData>(key, (old) =>
      old ? { ...old, replies: [...old.replies, optimistic] } : old,
    );

    try {
      const created = await apiSend<{ reply?: { id: string } & Partial<Message> }>(
        `/api/channels/${channelId}/messages/${rootMessageId}/thread`,
        'POST',
        { content: text },
      );
      const reply = created?.reply;
      if (reply) {
        const real: Message = {
          id: reply.id,
          channelId,
          authorId: reply.authorId ?? me?.id ?? '',
          authorName: reply.authorName ?? me?.name ?? null,
          authorImage: reply.authorImage ?? me?.image ?? null,
          content: reply.content ?? text,
          contentType: 'markdown',
          replyToId: null,
          attachments: reply.attachments ?? null,
          reactions: null,
          mentions: null,
          pinned: false,
          editedAt: null,
          deletedAt: null,
          createdAt: reply.createdAt ?? optimistic.createdAt,
        };
        qc.setQueryData<ThreadData>(key, (old) =>
          old
            ? {
                ...old,
                replies: [...old.replies.filter((m) => m.id !== tempId && m.id !== real.id), real],
              }
            : old,
        );
      } else {
        qc.setQueryData<ThreadData>(key, (old) =>
          old ? { ...old, replies: old.replies.filter((m) => m.id !== tempId) } : old,
        );
      }
    } catch (err) {
      qc.setQueryData<ThreadData>(key, (old) =>
        old ? { ...old, replies: old.replies.filter((m) => m.id !== tempId) } : old,
      );
      setContent(text);
      toast.error((err as Error).message);
    }
  };

  return (
    <aside className="bg-card fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l shadow-xl sm:w-[400px]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-sm font-semibold">Thread</span>
        <button
          onClick={onClose}
          aria-label="Đóng thread"
          className="hover:bg-accent ml-auto rounded p-1.5"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <ScrollArea ref={scrollRef} className="h-full">
          <div className="space-y-3 px-3 py-3">
            {loading ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang tải...
              </div>
            ) : !root ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                Message gốc không tồn tại
              </p>
            ) : (
              <>
                <ThreadMessage msg={root} highlight />
                <div className="text-muted-foreground flex items-center gap-2 text-[10px] uppercase tracking-wider">
                  <span className="bg-border h-px flex-1" />
                  {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                  <span className="bg-border h-px flex-1" />
                </div>
                {replies.map((m) => (
                  <ThreadMessage
                    key={m.id}
                    msg={m}
                    canMarkSolution={canMarkSolution}
                    onToggleSolution={canMarkSolution ? () => toggleSolution(m) : undefined}
                  />
                ))}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="bg-background shrink-0 border-t p-3">
        <div className="bg-card flex items-end gap-2 rounded-md border px-3 py-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                const isTouch =
                  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
                if (!isTouch) {
                  e.preventDefault();
                  send();
                }
              }
            }}
            placeholder="Trả lời trong thread..."
            rows={1}
            className="placeholder:text-muted-foreground flex-1 resize-none bg-transparent text-base outline-none sm:text-sm"
          />
          <Button
            onClick={send}
            disabled={!content.trim()}
            size="sm"
            className="h-9 w-9 shrink-0 p-0 sm:h-7 sm:w-auto sm:px-2"
            aria-label="Gửi"
          >
            <Send className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function ThreadMessage({
  msg,
  highlight = false,
  canMarkSolution = false,
  onToggleSolution,
}: {
  msg: Message;
  highlight?: boolean;
  canMarkSolution?: boolean;
  onToggleSolution?: () => void;
}) {
  return (
    <div
      className={cn(
        'group relative rounded-md',
        highlight && 'bg-amber-500/5 p-2',
        !highlight && 'p-1',
        msg.isSolution && 'border border-emerald-500/40 bg-emerald-500/5 p-2',
        msg.pending && 'opacity-55',
      )}
    >
      {msg.isSolution && (
        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          Giải pháp
        </div>
      )}
      <div className="flex items-start gap-2">
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarImage src={msg.authorImage ?? undefined} />
          <AvatarFallback className="text-[10px]">
            {(msg.authorName ?? 'U')[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold">{msg.authorName ?? 'Anonymous'}</span>
            <span className="text-muted-foreground text-[10px]">
              {new Date(msg.createdAt).toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {canMarkSolution && onToggleSolution && !msg.deletedAt && (
              <button
                type="button"
                onClick={onToggleSolution}
                className={cn(
                  'ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                  msg.isSolution
                    ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300'
                    : 'opacity-0 hover:bg-emerald-500/15 hover:text-emerald-700 group-hover:opacity-100 dark:hover:text-emerald-300',
                )}
                title={msg.isSolution ? 'Bỏ đánh dấu giải pháp' : 'Đánh dấu là giải pháp'}
              >
                <Check className="h-3 w-3" />
                {msg.isSolution ? 'Đã giải đáp' : 'Mark solution'}
              </button>
            )}
          </div>
          {msg.deletedAt ? (
            <p className="text-muted-foreground text-xs italic">Tin nhắn đã bị xoá</p>
          ) : (
            <>
              {msg.content && (
                <p className="whitespace-pre-wrap break-words text-sm">{msg.content}</p>
              )}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {msg.attachments.map((a, i) =>
                    a.type === 'image' ? (
                      <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={a.url}
                          alt={a.name}
                          className="max-h-[150px] max-w-[200px] rounded border object-cover"
                        />
                      </a>
                    ) : (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-muted rounded px-2 py-1 text-xs underline"
                      >
                        {a.name}
                      </a>
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
