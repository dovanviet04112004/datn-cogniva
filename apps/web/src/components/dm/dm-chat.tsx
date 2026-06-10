/**
 * DmChat — Messenger-style 1-1 chat UI.
 *
 * Layout patterns (Facebook Messenger / iMessage):
 *   - Header sticky top: back (mobile) + avatar peer + name + status
 *   - Messages scroll: bubbles căn left/right, grouped consecutive same-sender,
 *     hide repeated avatar, time separator giữa khoảng cách > 5 phút
 *   - Composer floating bottom: rounded-2xl, attach + textarea + send circular
 *
 * Bubble styling:
 *   - Mine: bg-primary text-primary-foreground, align right, rounded-2xl với
 *     rounded-br-md ở message cuối group
 *   - Peer: bg-muted, align left, rounded-2xl với rounded-bl-md ở first of group
 *
 * Realtime: subscribe `private-dm-{threadId}` cho message:new.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUp,
  Image as ImageIcon,
  Loader2,
  Minus,
  Paperclip,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { useRealtimeSetData } from '@/lib/query/use-realtime-query';
import { cn } from '@/lib/utils';

type Message = {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  content: string;
  replyToId: string | null;
  attachments: Array<{ type: string; url: string; name: string; size: number }> | null;
  reactions: Record<string, string[]> | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

type Attachment = {
  type: 'image' | 'file' | 'audio' | 'video';
  url: string;
  name: string;
  size: number;
  mime: string;
};

type Props = {
  threadId: string;
  peer: { id: string; name: string | null; image: string | null };
  currentUserId: string;
  /** compact = dùng trong ChatDock (cửa sổ nhỏ): ẩn nút back, thêm thu nhỏ/đóng. */
  compact?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
};

/** Khoảng thời gian (ms) giữa 2 message để chèn time separator. */
const TIME_SEPARATOR_MS = 5 * 60 * 1000;
/** Khoảng (ms) tối đa giữa 2 message để gộp group (cùng sender). */
const GROUP_GAP_MS = 2 * 60 * 1000;

export function DmChat({
  threadId,
  peer,
  currentUserId,
  compact = false,
  onClose,
  onMinimize,
}: Props) {
  // ── React Query: tin nhắn DM (cache + persist IndexedDB + revalidate) ──
  // Mở lại cửa sổ chat / đổi thread đã xem → hiện NGAY từ cache, revalidate ngầm.
  const { data: messages = [], isLoading: loading } = useQuery({
    queryKey: qk.dmMessages(threadId),
    queryFn: () =>
      apiGet<{ messages: Message[] }>(`/api/dm/${threadId}/messages?limit=50`).then(
        (d) => d.messages ?? [],
      ),
  });

  // Realtime: tin mới đẩy THẲNG vào cache (dedupe theo id) — không refetch.
  useRealtimeSetData<Message[], Message>(
    `private-dm-${threadId}`,
    'message:new',
    qk.dmMessages(threadId),
    (prev, m) => {
      const list = prev ?? [];
      return list.some((x) => x.id === m.id) ? list : [...list, m];
    },
  );

  const [content, setContent] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [uploading, setUploading] = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom khi messages thay đổi
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Auto-resize textarea
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [content]);

  const uploadFile = async (file: File) => {
    setUploading((n) => n + 1);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/groups/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as Attachment;
      setAttachments((prev) => [...prev, data]);
    } catch (err) {
      toast.error('Upload thất bại: ' + (err as Error).message);
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  };

  const send = async () => {
    if ((!content.trim() && attachments.length === 0) || sending || uploading > 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/dm/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      });
      if (!res.ok) throw new Error('Gửi thất bại');
      setContent('');
      setAttachments([]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header: peer info + back button (mobile) ── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-divider bg-card/40 px-4 backdrop-blur-md">
        {!compact && (
          <Link
            href="/messages"
            aria-label="Quay lại danh sách"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        {/* Trong dock: bấm tên/avatar mở trang messages đầy đủ */}
        {compact ? (
          <Link href={`/messages/${threadId}`} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarImage src={peer.image ?? undefined} />
              <AvatarFallback className="text-xs">
                {(peer.name ?? 'U')[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight">
                {peer.name ?? 'Unknown'}
              </p>
              <p className="text-[11px] text-text-muted">Đang hoạt động</p>
            </div>
          </Link>
        ) : (
          <>
            <Avatar className="h-9 w-9">
              <AvatarImage src={peer.image ?? undefined} />
              <AvatarFallback className="text-xs">
                {(peer.name ?? 'U')[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight">
                {peer.name ?? 'Unknown'}
              </p>
              <p className="text-[11px] text-text-muted">Đang hoạt động</p>
            </div>
          </>
        )}
        {(onMinimize || onClose) && (
          <div className="flex shrink-0 items-center gap-0.5">
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                aria-label="Thu nhỏ"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Minus className="h-4 w-4" />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </header>

      {/* ── Messages scroll ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex max-w-3xl flex-col px-3 py-4 sm:px-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang tải...
            </div>
          ) : messages.length === 0 ? (
            <EmptyConversation peer={peer} />
          ) : (
            <MessagesGroups
              messages={messages}
              currentUserId={currentUserId}
              peer={peer}
            />
          )}
        </div>
      </div>

      {/* ── Composer floating ── */}
      <div className="shrink-0 bg-background px-3 pb-4 pt-2 sm:px-4">
        <div className="mx-auto max-w-3xl">
          {/* Attachments preview */}
          {(attachments.length > 0 || uploading > 0) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 rounded-full border border-divider bg-muted/50 py-1 pl-2.5 pr-1 text-xs"
                >
                  <span className="max-w-[140px] truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {uploading > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Upload...
                </span>
              )}
            </div>
          )}

          {/* Input row — 1 thanh bo tròn, đính kèm + gửi nằm TRONG khung (Discord),
              không lòi ra ngoài lệch tông. */}
          <div className="flex items-end gap-1 rounded-3xl border border-divider bg-surface py-1 pl-2 pr-1.5 shadow-soft transition-all duration-base focus-within:border-primary/40 focus-within:shadow-glow">
            {/* Attach */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Đính kèm"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                for (const f of files) await uploadFile(f);
              }}
            />

              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    const isTouch =
                      typeof window !== 'undefined' &&
                      window.matchMedia('(pointer: coarse)').matches;
                    if (!isTouch) {
                      e.preventDefault();
                      send();
                    }
                  }
                }}
                onPaste={(e) => {
                  // Paste file/ảnh từ clipboard → upload qua /api/groups/upload.
                  // Text paste vẫn để browser xử lý native.
                  const files = Array.from(e.clipboardData.files);
                  if (files.length === 0) return;
                  e.preventDefault();
                  for (const f of files) void uploadFile(f);
                }}
                placeholder={`Tin nhắn tới ${peer.name ?? '...'}`}
                rows={1}
                className="block max-h-[140px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed outline-none placeholder:text-text-muted"
              />

            {/* Send button — circular primary */}
            <Button
              type="button"
              onClick={send}
              disabled={
                (!content.trim() && attachments.length === 0) || sending || uploading > 0
              }
              aria-label="Gửi"
              className="h-9 w-9 shrink-0 rounded-full p-0"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * MessagesGroups — render messages grouped by sender + time-cluster.
 * Time separator chèn khi gap > TIME_SEPARATOR_MS.
 * Avatar chỉ render ở first message of group (peer side).
 */
function MessagesGroups({
  messages,
  currentUserId,
  peer,
}: {
  messages: Message[];
  currentUserId: string;
  peer: { name: string | null; image: string | null };
}) {
  const items: React.ReactNode[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const prev = i > 0 ? messages[i - 1]! : null;
    const next = i < messages.length - 1 ? messages[i + 1]! : null;
    const mine = m.authorId === currentUserId;

    // Time separator giữa khoảng cách > TIME_SEPARATOR_MS
    if (
      !prev ||
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > TIME_SEPARATOR_MS
    ) {
      items.push(
        <TimeSeparator key={`time-${m.id}`} date={m.createdAt} />,
      );
    }

    // Group rules:
    //  - groupStart: là message đầu (prev khác sender hoặc gap > GROUP_GAP_MS)
    //  - groupEnd: là message cuối (next khác sender hoặc gap > GROUP_GAP_MS)
    const groupStart =
      !prev ||
      prev.authorId !== m.authorId ||
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
    const groupEnd =
      !next ||
      next.authorId !== m.authorId ||
      new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > GROUP_GAP_MS;

    items.push(
      <MessageBubble
        key={m.id}
        message={m}
        mine={mine}
        peer={peer}
        showAvatar={!mine && groupEnd}
        groupStart={groupStart}
        groupEnd={groupEnd}
      />,
    );
  }

  return <div className="flex flex-col gap-1">{items}</div>;
}

function TimeSeparator({ date }: { date: string }) {
  const d = new Date(date);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const label = sameDay
    ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
  return (
    <div className="my-3 flex items-center justify-center">
      <span className="font-mono text-[11px] tabular-nums text-text-muted">
        {label}
      </span>
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  peer,
  showAvatar,
  groupStart,
  groupEnd,
}: {
  message: Message;
  mine: boolean;
  peer: { name: string | null; image: string | null };
  showAvatar: boolean;
  groupStart: boolean;
  groupEnd: boolean;
}) {
  // Rounded corners adjustment cho group:
  //   - Mine + first of group: rounded-tr-md (sharp top-right)
  //   - Mine + last of group: rounded-br-md (sharp bottom-right)
  //   - Mine + middle: rounded-r-md (both sharp)
  //   - Peer: mirror với left side
  const bubbleRadius = mine
    ? cn(
        'rounded-2xl',
        groupStart && !groupEnd && 'rounded-br-md',
        !groupStart && groupEnd && 'rounded-tr-md',
        !groupStart && !groupEnd && 'rounded-r-md',
      )
    : cn(
        'rounded-2xl',
        groupStart && !groupEnd && 'rounded-bl-md',
        !groupStart && groupEnd && 'rounded-tl-md',
        !groupStart && !groupEnd && 'rounded-l-md',
      );

  return (
    <div
      className={cn(
        'flex items-end gap-2',
        mine ? 'flex-row-reverse' : 'flex-row',
        // Group spacing: gap nhỏ khi cùng group, gap to khi đổi group
        groupStart ? 'mt-2' : 'mt-0.5',
      )}
    >
      {/* Avatar — chỉ hiện ở message cuối của peer group */}
      {!mine && (
        <div className="w-7 shrink-0">
          {showAvatar && (
            <Avatar className="h-7 w-7">
              <AvatarImage src={peer.image ?? undefined} />
              <AvatarFallback className="text-[10px]">
                {(peer.name ?? 'U')[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      )}

      <div
        className={cn(
          'max-w-[75%] px-3.5 py-2 text-[15px] leading-relaxed transition-colors',
          bubbleRadius,
          mine
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/80 text-foreground',
        )}
      >
        {message.deletedAt ? (
          <p className="text-xs italic opacity-70">Tin đã xoá</p>
        ) : (
          <>
            {message.content && (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}
            {message.attachments && message.attachments.length > 0 && (
              <div className={cn('flex flex-wrap gap-1', message.content && 'mt-1.5')}>
                {message.attachments.map((a, i) =>
                  a.type === 'image' ? (
                    <a
                      key={i}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.url}
                        alt={a.name}
                        className="max-h-[240px] max-w-[260px] rounded-lg object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      key={i}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs underline-offset-2 hover:underline',
                        mine ? 'bg-primary-foreground/15' : 'bg-background/60',
                      )}
                    >
                      <ImageIcon className="h-3 w-3" />
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
  );
}

/** Empty conversation placeholder — invite first message. */
function EmptyConversation({
  peer,
}: {
  peer: { name: string | null; image: string | null };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <Avatar className="h-16 w-16">
        <AvatarImage src={peer.image ?? undefined} />
        <AvatarFallback className="text-xl">
          {(peer.name ?? 'U')[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="text-base font-semibold tracking-tight">
          {peer.name ?? 'Unknown'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Bắt đầu hội thoại — gõ tin đầu tiên bên dưới.
        </p>
      </div>
    </div>
  );
}
