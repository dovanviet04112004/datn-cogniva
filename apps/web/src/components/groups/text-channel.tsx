'use client';

import * as React from 'react';
import { Hash, Megaphone, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { useRealtimeSetData } from '@/lib/query/use-realtime-query';
import type { StudyGroupChannel } from '@cogniva/db';

import { ChannelHeaderActions } from './channel-header-actions';
import { ThreadsPopover } from './threads-popover';
import { useDensity } from './density-context';
import { MessageItem, type Message } from './message-item';
import { MessageComposer } from './message-composer';
import { ThreadPanel } from './thread-panel';
import { TypingIndicator } from './typing-indicator';

type Props = {
  channel: StudyGroupChannel;
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
};

type MsgPage = { messages: Message[]; hasMore: boolean };

export function TextChannel({ channel, myRole, currentUserId }: Props) {
  const qc = useQueryClient();
  const msgKey = qk.channelMessages(channel.id);
  const chanName = `private-channel-${channel.id}`;

  const { data, isLoading: loading } = useQuery({
    queryKey: msgKey,
    queryFn: () => apiGet<MsgPage>(`/api/channels/${channel.id}/messages?limit=50`),
  });
  const messages = React.useMemo(() => data?.messages ?? [], [data]);
  const hasMore = data?.hasMore ?? false;

  const { data: readData } = useQuery({
    queryKey: qk.channelRead(channel.id),
    queryFn: () =>
      apiGet<{ lastReadMessageId: string | null }>(`/api/channels/${channel.id}/read`).catch(
        () => ({ lastReadMessageId: null }),
      ),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const readSnapshot = readData?.lastReadMessageId ?? null;

  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [replyingTo, setReplyingTo] = React.useState<Message | null>(null);
  const [threadOpenId, setThreadOpenId] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const { density } = useDensity();

  React.useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  React.useEffect(() => {
    if (loading) return;
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#message-')) return;
    const id = hash.slice('#message-'.length);
    if (!messages.some((m) => m.id === id)) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`message-${id}`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.setAttribute('data-highlight', 'true');
      const t = setTimeout(() => el.removeAttribute('data-highlight'), 2000);
      return () => clearTimeout(t);
    });
  }, [loading, messages]);

  useRealtimeSetData<MsgPage, Message>(chanName, 'message:new', msgKey, (prev, msg) => {
    const cur = prev ?? { messages: [], hasMore: false };
    if (cur.messages.some((m) => m.id === msg.id)) return cur;
    return { ...cur, messages: [...cur.messages, msg] };
  });
  useRealtimeSetData<MsgPage, { id: string; content: string; editedAt: string }>(
    chanName,
    'message:edit',
    msgKey,
    (prev, d) =>
      prev && {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === d.id ? { ...m, content: d.content, editedAt: d.editedAt } : m,
        ),
      },
  );
  useRealtimeSetData<MsgPage, { id: string }>(chanName, 'message:delete', msgKey, (prev, d) =>
    prev
      ? {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === d.id ? { ...m, deletedAt: new Date().toISOString() as unknown as string } : m,
          ),
        }
      : prev,
  );
  useRealtimeSetData<MsgPage, { id: string; reactions: Record<string, string[]> }>(
    chanName,
    'message:react',
    msgKey,
    (prev, d) =>
      prev && {
        ...prev,
        messages: prev.messages.map((m) => (m.id === d.id ? { ...m, reactions: d.reactions } : m)),
      },
  );
  useRealtimeSetData<MsgPage, { id: string; pinned: boolean }>(
    chanName,
    'message:pin',
    msgKey,
    (prev, d) =>
      prev && {
        ...prev,
        messages: prev.messages.map((m) => (m.id === d.id ? { ...m, pinned: d.pinned } : m)),
      },
  );
  useRealtimeSetData<MsgPage, { threadRootId: string; createdAt: string }>(
    chanName,
    'thread:new-reply',
    msgKey,
    (prev, d) =>
      prev && {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === d.threadRootId
            ? { ...m, threadCount: (m.threadCount ?? 0) + 1, threadLastAt: d.createdAt }
            : m,
        ),
      },
  );

  React.useEffect(() => {
    if (messages.length === 0) return;
    if (document.visibilityState !== 'visible') return;
    const last = messages[messages.length - 1];
    if (!last) return;
    fetch(`/api/channels/${channel.id}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastMessageId: last.id }),
    }).catch(() => {});
  }, [messages, channel.id]);

  const loadOlder = async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const d = await apiGet<MsgPage>(
        `/api/channels/${channel.id}/messages?before=${oldest.id}&limit=50`,
      );
      qc.setQueryData<MsgPage>(msgKey, (prev) => {
        const cur = prev ?? { messages: [], hasMore: false };
        return { messages: [...d.messages, ...cur.messages], hasMore: d.hasMore };
      });
    } catch {
      toast.error('Không tải được tin nhắn cũ');
    } finally {
      setLoadingOlder(false);
    }
  };

  const HeaderIcon = channel.type === 'ANNOUNCEMENT' ? Megaphone : Hash;

  return (
    <div className="bg-background flex h-full flex-col">
      <header className="glass border-divider sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2.5 border-b pl-14 pr-14 md:pl-6 md:pr-14">
        <div className="bg-muted text-text-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
          <HeaderIcon className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="truncate text-[15px] font-semibold tracking-tight">{channel.name}</span>
          {channel.topic && (
            <>
              <span className="bg-divider hidden h-3 w-px sm:block" />
              <span className="text-muted-foreground hidden truncate text-xs sm:inline">
                {channel.topic}
              </span>
            </>
          )}
        </div>
        {channel.slowModeSeconds ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tabular-nums tracking-[0.08em] text-amber-700 dark:text-amber-400">
            Slow {channel.slowModeSeconds}s
          </span>
        ) : null}
        <ThreadsPopover channelId={channel.id} onOpenThread={(id) => setThreadOpenId(id)} />
        <ChannelHeaderActions channelId={channel.id} groupId={channel.groupId} />
      </header>

      <div className="min-h-0 flex-1">
        <ScrollArea ref={scrollRef} className="h-full">
          <div className="max-w-screen-2xl px-3 py-3 sm:px-4 lg:px-6">
            {hasMore && (
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="border-divider bg-surface-secondary/40 text-muted-foreground hover:bg-muted hover:text-foreground mb-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-xs transition-colors disabled:opacity-50"
              >
                {loadingOlder ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Đang tải...
                  </>
                ) : (
                  'Tải tin cũ hơn'
                )}
              </button>
            )}
            {loading ? (
              <div className="text-muted-foreground flex items-center justify-center py-12 text-sm">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Đang tải tin nhắn...
              </div>
            ) : messages.length === 0 ? (
              <EmptyChannel channelName={channel.name} />
            ) : (
              <ul className="flex flex-col gap-0.5 pb-2" data-density={density}>
                {(() => {
                  const groupThresholdMs = density === 'compact' ? 10 * 60 * 1000 : 5 * 60 * 1000;

                  let dividerBeforeIndex = -1;
                  if (readSnapshot) {
                    const snapIdx = messages.findIndex((x) => x.id === readSnapshot);
                    if (snapIdx >= 0 && snapIdx < messages.length - 1) {
                      dividerBeforeIndex = snapIdx + 1;
                    }
                  }
                  if (
                    dividerBeforeIndex >= 0 &&
                    messages[dividerBeforeIndex]?.authorId === currentUserId
                  ) {
                    dividerBeforeIndex = -1;
                  }

                  return messages.map((m, i) => {
                    const prev = i > 0 ? messages[i - 1] : null;
                    const grouped = !!(
                      prev &&
                      prev.authorId === m.authorId &&
                      !prev.deletedAt &&
                      !m.deletedAt &&
                      !m.replyToId &&
                      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <
                        groupThresholdMs
                    );
                    const replyTarget = m.replyToId
                      ? (messages.find((x) => x.id === m.replyToId) ?? null)
                      : null;
                    const prevDay = prev ? new Date(prev.createdAt).toDateString() : null;
                    const showDate = new Date(m.createdAt).toDateString() !== prevDay;
                    return (
                      <React.Fragment key={m.id}>
                        {showDate && <DateDivider date={m.createdAt} />}
                        {i === dividerBeforeIndex && <UnreadDivider />}
                        <MessageItem
                          msg={m}
                          replyTarget={replyTarget}
                          grouped={showDate || i === dividerBeforeIndex ? false : grouped}
                          myRole={myRole}
                          currentUserId={currentUserId}
                          channelId={channel.id}
                          groupId={channel.groupId}
                          onReply={setReplyingTo}
                          onOpenThread={(x) => setThreadOpenId(x.id)}
                        />
                      </React.Fragment>
                    );
                  });
                })()}
              </ul>
            )}
          </div>
        </ScrollArea>
      </div>

      <TypingIndicator channelId={channel.id} />

      <MessageComposer
        channel={channel}
        myRole={myRole}
        replyingTo={replyingTo}
        onClearReply={() => setReplyingTo(null)}
      />

      {threadOpenId && (
        <ThreadPanel
          channelId={channel.id}
          rootMessageId={threadOpenId}
          onClose={() => setThreadOpenId(null)}
        />
      )}
    </div>
  );
}

function DateDivider({ date }: { date: string }) {
  return (
    <li role="separator" className="my-3 flex select-none items-center gap-3 px-2">
      <span className="bg-divider h-px flex-1" />
      <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider">
        {new Date(date).toLocaleDateString('vi-VN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </span>
      <span className="bg-divider h-px flex-1" />
    </li>
  );
}

function UnreadDivider() {
  return (
    <li
      role="separator"
      aria-label="Tin nhắn mới"
      className="my-1.5 flex select-none items-center gap-2 px-2"
    >
      <span className="h-px flex-1 bg-red-500/60" />
      <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm">
        Tin mới
      </span>
      <span className="h-px w-8 bg-red-500/60" />
    </li>
  );
}

function EmptyChannel({ channelName }: { channelName: string }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div
        aria-hidden
        className="bg-primary/10 pointer-events-none absolute left-1/2 top-8 h-32 w-32 -translate-x-1/2 rounded-full blur-2xl"
      />
      <div className="bg-primary/10 text-primary ring-primary/20 relative flex h-14 w-14 items-center justify-center rounded-2xl ring-1 ring-inset">
        <Hash className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <div className="relative space-y-1">
        <p className="text-base font-semibold tracking-tight">Chào mừng đến #{channelName}</p>
        <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
          Đây là channel mới — gõ tin nhắn đầu tiên để bắt đầu hội thoại.
        </p>
      </div>
    </div>
  );
}
