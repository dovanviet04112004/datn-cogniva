/**
 * TextChannel — render header + message list (scrollable) + composer.
 *
 * Realtime:
 *   - Subscribe `private-channel-{channelId}` realtime (Socket.IO)
 *   - Event `message:new` → append vào danh sách
 *   - Event `message:edit` / `message:delete` / `message:react` → update inline
 *
 * Read state:
 *   - Khi tab visible + có message mới → POST /api/channels/[id]/read với id cuối
 *
 * Pagination:
 *   - Scroll lên đầu → fetch `?before=oldestId` → prepend
 */
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

/** Trang tin nhắn channel trả về từ API — list + cờ còn-tin-cũ để phân trang. */
type MsgPage = { messages: Message[]; hasMore: boolean };

export function TextChannel({ channel, myRole, currentUserId }: Props) {
  const qc = useQueryClient();
  const msgKey = qk.channelMessages(channel.id);
  const chanName = `private-channel-${channel.id}`;

  // ── React Query: tin nhắn channel (cache + persist IndexedDB + revalidate) ──
  // Quay lại channel trong staleTime (60s) → hiện NGAY từ cache, không spinner;
  // quá hạn → hiện cache cũ + revalidate ngầm. queryFn fetch 50 tin mới nhất.
  const { data, isLoading: loading } = useQuery({
    queryKey: msgKey,
    queryFn: () => apiGet<MsgPage>(`/api/channels/${channel.id}/messages?limit=50`),
  });
  const messages = React.useMemo(() => data?.messages ?? [], [data]);
  const hasMore = data?.hasMore ?? false;

  // Divider "X tin mới": lastReadMessageId snapshot lúc VÀO channel. staleTime/gcTime 0
  // + không refetch-on-focus → fresh mỗi lần vào nhưng đứng yên suốt session (POST
  // /read cập nhật server không kéo divider chạy).
  const { data: readData } = useQuery({
    queryKey: qk.channelRead(channel.id),
    queryFn: () =>
      apiGet<{ lastReadMessageId: string | null }>(
        `/api/channels/${channel.id}/read`,
      ).catch(() => ({ lastReadMessageId: null })),
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

  // Auto-scroll xuống bottom khi có message mới
  React.useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // V2 G7.1: jump-to-message từ hash. Khi search hoặc external link mở
  // /groups/{id}/{ch}#message-{msgId} → scroll vào view + flash highlight 2s.
  React.useEffect(() => {
    if (loading) return;
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#message-')) return;
    const id = hash.slice('#message-'.length);
    // Cần messages đã load + node trong DOM
    if (!messages.some((m) => m.id === id)) return;
    // requestAnimationFrame để chắc layout đã commit
    requestAnimationFrame(() => {
      const el = document.getElementById(`message-${id}`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.setAttribute('data-highlight', 'true');
      const t = setTimeout(() => el.removeAttribute('data-highlight'), 2000);
      return () => clearTimeout(t);
    });
  }, [loading, messages]);

  // ── Realtime → cập nhật THẲNG vào cache React Query (không refetch). Bail (trả
  //    undefined) khi chưa có data để khỏi đè cache rỗng. ──
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
            m.id === d.id
              ? { ...m, deletedAt: new Date().toISOString() as unknown as string }
              : m,
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

  // Update read state khi có message mới
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

  // Presence: realtime qua Socket.IO presence-group-{id} (xem PresenceProvider).
  // V1 polling lastSeenAt đã thay bằng presence channel — không cần ping API nữa.

  // Load older khi scroll lên đầu
  const loadOlder = async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const d = await apiGet<MsgPage>(
        `/api/channels/${channel.id}/messages?before=${oldest.id}&limit=50`,
      );
      // Prepend tin cũ vào cache hiện tại (giữ realtime/tin mới ở cuối).
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
    <div className="flex h-full flex-col bg-background">
      {/* ── Header — sticky glass, name + topic + slowmode badge + actions ── */}
      <header className="glass sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2.5 border-b border-divider pl-14 pr-14 md:pl-6 md:pr-14">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-text-muted">
          <HeaderIcon className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="truncate text-[15px] font-semibold tracking-tight">
            {channel.name}
          </span>
          {channel.topic && (
            <>
              <span className="hidden h-3 w-px bg-divider sm:block" />
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {channel.topic}
              </span>
            </>
          )}
        </div>
        {channel.slowModeSeconds ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums uppercase tracking-[0.08em] text-amber-700 dark:text-amber-400">
            Slow {channel.slowModeSeconds}s
          </span>
        ) : null}
        <ThreadsPopover
          channelId={channel.id}
          onOpenThread={(id) => setThreadOpenId(id)}
        />
        <ChannelHeaderActions channelId={channel.id} groupId={channel.groupId} />
      </header>

      {/* ── Message list scroll ── */}
      <div className="min-h-0 flex-1">
        <ScrollArea ref={scrollRef} className="h-full">
          {/* Discord-style: tin nhắn trải rộng TRÁI (bỏ mx-auto max-w-4xl bó giữa),
              chỉ cap max-w-screen-2xl cho màn siêu rộng khỏi quá dài khó đọc. */}
          <div className="max-w-screen-2xl px-3 py-3 sm:px-4 lg:px-6">
            {hasMore && (
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-divider bg-surface-secondary/40 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
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
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Đang tải tin nhắn...
              </div>
            ) : messages.length === 0 ? (
              <EmptyChannel channelName={channel.name} />
            ) : (
              <ul
                className="flex flex-col gap-0.5 pb-2"
                data-density={density}
              >
                {(() => {
                  // V2 G2.5: compact mode kéo dài threshold group 10min để dồn
                  // message hơn (Discord pattern); cozy giữ 5min mặc định.
                  const groupThresholdMs = density === 'compact' ? 10 * 60 * 1000 : 5 * 60 * 1000;

                  // V2 quick win 5: tính index divider trước khi map.
                  // Divider hiện TRƯỚC msg đầu tiên user CHƯA đọc (msg sau snapshot).
                  let dividerBeforeIndex = -1;
                  if (readSnapshot) {
                    const snapIdx = messages.findIndex((x) => x.id === readSnapshot);
                    if (snapIdx >= 0 && snapIdx < messages.length - 1) {
                      dividerBeforeIndex = snapIdx + 1;
                    }
                  }
                  // Skip divider nếu message đầu tiên unread là của chính mình
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
                      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < groupThresholdMs
                    );
                    const replyTarget = m.replyToId
                      ? messages.find((x) => x.id === m.replyToId) ?? null
                      : null;
                    // Date divider khi sang ngày mới (Discord pattern). Tin ngay
                    // sau divider luôn render header đầy đủ (không group).
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

      {/* Typing indicator — V2 quick win 3: render footer trên composer khi
          có user khác đang gõ. Reserved height 20px tránh layout shift. */}
      <TypingIndicator channelId={channel.id} />

      {/* Composer */}
      <MessageComposer
        channel={channel}
        myRole={myRole}
        replyingTo={replyingTo}
        onClearReply={() => setReplyingTo(null)}
      />

      {/* Thread panel — slide-in từ phải khi user mở thread */}
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

/**
 * DateDivider — vạch ngăn trung tính khi sang ngày mới (Discord pattern):
 * "29 tháng 5, 2026" ở giữa 2 đường kẻ mảnh.
 */
function DateDivider({ date }: { date: string }) {
  return (
    <li role="separator" className="my-3 flex select-none items-center gap-3 px-2">
      <span className="h-px flex-1 bg-divider" />
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {new Date(date).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' })}
      </span>
      <span className="h-px flex-1 bg-divider" />
    </li>
  );
}

/**
 * UnreadDivider — V2 quick win 5: red line + "Tin mới" badge giữa message đã
 * đọc và chưa đọc (Discord pattern). Render bằng React.Fragment giữa map.
 */
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

/**
 * EmptyChannel — placeholder khi channel chưa có message.
 * Premium with accent glow halo + invite tagline.
 */
function EmptyChannel({ channelName }: { channelName: string }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-8 h-32 w-32 -translate-x-1/2 rounded-full bg-primary/10 blur-2xl"
      />
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
        <Hash className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <div className="relative space-y-1">
        <p className="text-base font-semibold tracking-tight">
          Chào mừng đến #{channelName}
        </p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          Đây là channel mới — gõ tin nhắn đầu tiên để bắt đầu hội thoại.
        </p>
      </div>
    </div>
  );
}
