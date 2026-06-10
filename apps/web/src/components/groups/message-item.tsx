/**
 * MessageItem — 1 dòng message + author + time + reactions + action menu hover.
 *
 * Grouped: nếu message kế tiếp cùng author trong 5 phút → hide header.
 * Soft-delete: render placeholder "Tin nhắn đã bị xoá".
 * Edit: hiển thị badge "(đã sửa)" cuối content.
 */
'use client';

import * as React from 'react';
import { Flag, Pencil, Trash2, SmilePlus, Check, X, Reply, CornerDownRight, Pin, MessageCircleMore } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { can, type GroupRole } from '@/lib/group/permissions';
import { ReportDialog } from '@/components/reports/report-dialog';

import { RichContent } from './rich-content';
import { EmojiPicker } from './emoji-picker';
import { MessageHistoryDialog } from './message-history-dialog';
import { ProfileHoverCard } from './profile-hover-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '🤔', '😢'];

/**
 * Màu tên user ổn định theo authorId (Discord cho mỗi người 1 màu). Hue lệch
 * khỏi vùng đỏ-cam khó phân biệt (bắt đầu từ 30). L=45% để đọc rõ trên nền sáng.
 */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 30 + (h % 310);
}

export type Message = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  content: string;
  contentType: string;
  replyToId: string | null;
  attachments: Array<{
    type: 'image' | 'file' | 'audio' | 'video';
    url: string;
    name: string;
    size: number;
    mime: string;
  }> | null;
  reactions: Record<string, string[]> | null;
  mentions: Array<{ type: string; id: string }> | null;
  pinned: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** V2 threads: số reply, null nếu chưa có thread */
  threadCount?: number;
  threadLastAt?: string | null;
  /** V2 G5.4: reply trong forum thread được đánh dấu là solution. */
  isSolution?: boolean;
};

type Props = {
  msg: Message;
  /** Khi msg.replyToId trỏ tới message X, render chip mini preview của X (nếu còn). */
  replyTarget?: Message | null;
  grouped: boolean;
  myRole: GroupRole;
  currentUserId: string;
  channelId: string;
  /** V2 G7.2: pass-through để ProfileHoverCard fetch /api/groups/[gid]/members/[uid] */
  groupId: string;
  /** Gọi khi user bấm Reply — TextChannel set replyingTo state. */
  onReply?: (msg: Message) => void;
  /** Gọi khi user bấm mở thread — TextChannel mở ThreadPanel. */
  onOpenThread?: (msg: Message) => void;
};

export function MessageItem({
  msg,
  replyTarget,
  grouped,
  currentUserId,
  channelId,
  groupId,
  myRole,
  onReply,
  onOpenThread,
}: Props) {
  const [editing, setEditing] = React.useState(false);
  const [editContent, setEditContent] = React.useState(msg.content);
  const [showEmojiBar, setShowEmojiBar] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  /** V2 G7 polish: confirm dialog xoá tin nhắn thay native confirm(). */
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  /**
   * Mobile-only: tap message body để toggle hiện toolbar (desktop dùng hover).
   * `:hover` simulate trên iOS Safari không đáng tin → cần explicit state.
   * Tap outside body / message khác sẽ tự clear qua document listener.
   */
  const [mobileActive, setMobileActive] = React.useState(false);
  const liRef = React.useRef<HTMLLIElement>(null);

  React.useEffect(() => {
    if (!mobileActive) return;
    const onDown = (e: PointerEvent) => {
      const node = liRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) {
        setMobileActive(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [mobileActive]);

  const isOwn = msg.authorId === currentUserId;
  const canDelete = isOwn || can(myRole, 'message.delete-any');
  const canPin = can(myRole, 'message.pin');
  /** Report chỉ hiện cho message KHÔNG phải của mình + chưa bị xoá. */
  const canReport = !isOwn && !msg.deletedAt;
  const isDeleted = !!msg.deletedAt;

  const saveEdit = async () => {
    if (!editContent.trim() || editContent === msg.content) {
      setEditing(false);
      setEditContent(msg.content);
      return;
    }
    try {
      const res = await fetch(`/api/channels/${channelId}/messages/${msg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      if (!res.ok) throw new Error('Edit thất bại');
      setEditing(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  /**
   * Thực thi xoá — gọi từ ConfirmDialog.onConfirm. KHÔNG còn confirm() native
   * vì popup browser kèm prefix "localhost:3000 cho biết" trông thiếu chuyên
   * nghiệp + không match theme.
   */
  const deleteMsg = async () => {
    const res = await fetch(`/api/channels/${channelId}/messages/${msg.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      toast.error('Xoá thất bại: ' + (err?.error ?? `status ${res.status}`));
      throw new Error('delete-failed');
    }
  };

  const togglePin = async () => {
    try {
      const res = await fetch(`/api/channels/${channelId}/messages/${msg.id}/pin`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Pin thất bại');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggleReact = async (emoji: string) => {
    setShowEmojiBar(false);
    try {
      const res = await fetch(`/api/channels/${channelId}/messages/${msg.id}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (!res.ok) throw new Error('React thất bại');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const time = new Date(msg.createdAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // V2 G2.5: density-aware spacing. Compact = thưa hơn theo Discord pattern.
  // Sử dụng group/parent selectors qua data-density attr trên <ul> cha.
  //
  // V2 G7.1 (2026-05-21): id="message-{id}" để jump-to-message từ search +
  // permalink. data-message-id phục vụ event delegation nếu cần.
  return (
    <li
      ref={liRef}
      id={`message-${msg.id}`}
      data-message-id={msg.id}
      data-mobile-active={mobileActive ? 'true' : undefined}
      onClick={(e) => {
        // Chỉ trigger trên touch device — desktop dùng hover, không cần state.
        // Skip nếu user click vào action button (đã trigger handler riêng).
        if (typeof window === 'undefined') return;
        if (!('ontouchstart' in window)) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, textarea, [role="button"]')) return;
        setMobileActive((s) => !s);
      }}
      className={cn(
        'group relative px-3 transition-colors hover:bg-muted/60',
        // V2 G7.1: target=focus-visible highlight (driven bởi TextChannel
        // qua [data-highlight="true"]). 2s flash → fade out.
        'data-[highlight=true]:bg-amber-500/15 data-[highlight=true]:ring-2 data-[highlight=true]:ring-amber-500/40 data-[highlight=true]:transition-all',
        // Cozy (default): py-3/0.5 + avatar 40px + pl-60
        // Compact: gap rất nhỏ, avatar 28px + pl-44, font 13.5px → áp dụng qua
        // CSS [data-density="compact"] ở parent ul
        grouped
          ? 'py-0.5 pl-[60px] [[data-density="compact"]_&]:pl-[44px]'
          : 'pt-3 pb-0.5 [[data-density="compact"]_&]:pt-1.5',
        'text-[15px] [[data-density="compact"]_&]:text-[13.5px]',
        msg.pinned && 'bg-primary/[0.04] before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-primary/60',
      )}
    >
      {!grouped && (
        <div className="absolute left-3 top-3 [[data-density=&quot;compact&quot;]_&]:top-1.5">
          {/* V2 G7.2: hover avatar → ProfileHoverCard với detail member */}
          <ProfileHoverCard
            groupId={groupId}
            userId={msg.authorId}
            isSelf={msg.authorId === currentUserId}
          >
            <Avatar className="h-10 w-10 cursor-pointer [[data-density=&quot;compact&quot;]_&]:h-7 [[data-density=&quot;compact&quot;]_&]:w-7">
              <AvatarImage src={msg.authorImage ?? undefined} />
              <AvatarFallback className="text-xs font-semibold">
                {(msg.authorName ?? 'U')[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </ProfileHoverCard>
        </div>
      )}

      {/* Tin bị group ẩn avatar+header → hiện giờ mờ ở gutter trái khi hover
          (đúng chỗ avatar sẽ ở). Discord pattern. */}
      {grouped && !isDeleted && (
        <span
          className={cn(
            'pointer-events-none absolute left-0 top-1/2 w-[58px] -translate-y-1/2 text-center font-mono text-[11px] tabular-nums text-text-muted opacity-0 transition-opacity group-hover:opacity-100',
            '[[data-density="compact"]_&]:w-[42px]',
          )}
        >
          {time}
        </span>
      )}

      <div
        className={cn(
          'min-w-0',
          !grouped && 'pl-[48px] [[data-density="compact"]_&]:pl-[36px]',
          msg.replyToId && 'pl-[48px] [[data-density="compact"]_&]:pl-[36px]',
        )}
      >
        {/* Reply chip — preview message gốc với rounded pill */}
        {msg.replyToId && (
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CornerDownRight className="h-3 w-3 text-text-muted" />
            {replyTarget ? (
              <>
                <span className="font-medium text-foreground/80">
                  {replyTarget.authorName ?? 'Anonymous'}
                </span>
                <span className="max-w-[400px] truncate text-text-muted">
                  {replyTarget.deletedAt ? '(tin đã xoá)' : replyTarget.content}
                </span>
              </>
            ) : (
              <span className="italic text-text-muted">trả lời tin nhắn không còn</span>
            )}
          </div>
        )}
        {!grouped && (
          <div className="flex items-baseline gap-2">
            {/* V2 G7.2: hover name → ProfileHoverCard (alternate trigger) */}
            <ProfileHoverCard
              groupId={groupId}
              userId={msg.authorId}
              isSelf={msg.authorId === currentUserId}
            >
              <span
                className="cursor-pointer text-[15px] font-semibold tracking-tight hover:underline"
                style={{ color: `hsl(${hueFromString(msg.authorId)} 60% 45%)` }}
              >
                {msg.authorName ?? 'Anonymous'}
              </span>
            </ProfileHoverCard>
            <span className="font-mono text-[11px] tabular-nums text-text-muted">
              {time}
            </span>
          </div>
        )}

        {isDeleted ? (
          <p className="text-xs italic text-muted-foreground">Tin nhắn đã bị xoá</p>
        ) : editing ? (
          <div className="flex gap-1">
            <input
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') {
                  setEditing(false);
                  setEditContent(msg.content);
                }
              }}
              autoFocus
              className="flex-1 rounded border bg-background px-2 py-1 text-sm"
            />
            <button onClick={saveEdit} className="rounded p-1 hover:bg-accent">
              <Check className="h-3.5 w-3.5 text-green-600" />
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setEditContent(msg.content);
              }}
              className="rounded p-1 hover:bg-accent"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <>
            {msg.content && (
              <>
                <RichContent content={msg.content} />
                {msg.editedAt && (
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(true)}
                    title={`Đã chỉnh sửa ${new Date(msg.editedAt).toLocaleString('vi-VN')}`}
                    className="ml-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    (đã sửa)
                  </button>
                )}
              </>
            )}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-2">
                {msg.attachments.map((a, i) => (
                  <Attachment key={i} att={a} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Thread count chip */}
        {!isDeleted && (msg.threadCount ?? 0) > 0 && onOpenThread && (
          <button
            onClick={() => onOpenThread(msg)}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
          >
            <MessageCircleMore className="h-3 w-3" />
            <span className="font-medium tracking-tight">
              {msg.threadCount} {msg.threadCount === 1 ? 'reply' : 'replies'}
            </span>
            {msg.threadLastAt && (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {new Date(msg.threadLastAt).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </button>
        )}

        {/* Reactions row — pill subtle, primary tinted khi mine reacted */}
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(msg.reactions).map(([emoji, uids]) => {
              const mineReacted = uids.includes(currentUserId);
              return (
                <button
                  key={emoji}
                  onClick={() => toggleReact(emoji)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                    mineReacted
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-divider bg-muted/60 text-muted-foreground hover:bg-muted',
                  )}
                  title={`${uids.length} người react`}
                >
                  <span className="text-[13px] leading-none">{emoji}</span>
                  <span className="font-mono text-[11px] tabular-nums">
                    {uids.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Action menu — floating toolbar.
          Desktop: hidden, hover-reveal.
          Mobile: hidden, tap message → sticky hover (mobile browser simulate
          hover sau tap đầu, tap chỗ khác clear). KHÔNG dùng max-md:opacity-70
          vì làm toolbar luôn nhìn thấy trên mọi tin nhắn — gây rối UI.
          Premium: rounded-lg + shadow-elevated + glass + button rounded. */}
      {!isDeleted && !editing && (
        <div className="glass-elevated absolute right-2 -top-3 z-10 flex gap-0.5 rounded-lg border border-divider p-1 opacity-0 shadow-elevated transition-opacity duration-base group-hover:opacity-100 group-focus-within:opacity-100 group-data-[mobile-active=true]:opacity-100">
          <div className="relative">
            <button
              onClick={() => setShowEmojiBar((s) => !s)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="React"
            >
              <SmilePlus className="h-4 w-4" />
            </button>
            {showEmojiBar && (
              <div className="absolute right-0 top-9 z-10 flex flex-col gap-1">
                {/* Quick row trên cùng cho 6 emoji phổ biến — 1 click. */}
                <div className="glass-elevated flex gap-0.5 rounded-lg border border-divider p-1 shadow-elevated">
                  {QUICK_EMOJI.map((e) => (
                    <button
                      key={e}
                      onClick={() => toggleReact(e)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base transition-transform hover:scale-110 hover:bg-muted"
                    >
                      {e}
                    </button>
                  ))}
                </div>
                {/* Full picker dưới quick row — categorized + search. */}
                <EmojiPicker
                  onSelect={(e) => toggleReact(e)}
                  onClose={() => setShowEmojiBar(false)}
                  autoFocus={false}
                />
              </div>
            )}
          </div>
          {onReply && (
            <button
              onClick={() => onReply(msg)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Trả lời"
            >
              <Reply className="h-4 w-4" />
            </button>
          )}
          {onOpenThread && (
            <button
              onClick={() => onOpenThread(msg)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Mở thread"
            >
              <MessageCircleMore className="h-4 w-4" />
            </button>
          )}
          {canPin && (
            <button
              onClick={togglePin}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground',
                msg.pinned ? 'text-primary' : 'text-muted-foreground',
              )}
              title={msg.pinned ? 'Bỏ pin' : 'Pin'}
            >
              <Pin className="h-4 w-4" />
            </button>
          )}
          {isOwn && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Sửa"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {canReport && (
            <button
              onClick={() => setReportOpen(true)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-500"
              title="Báo cáo"
            >
              <Flag className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Xoá"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {canReport && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          targetType="group_message"
          targetId={msg.id}
          targetLabel={`tin nhắn của ${msg.authorName ?? 'user'}`}
        />
      )}
      {/* V2 G2.7: edit history modal — chỉ mount khi user mở (lazy fetch). */}
      {msg.editedAt && historyOpen && (
        <MessageHistoryDialog
          channelId={channelId}
          messageId={msg.id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      )}
      {/* Custom delete confirm — thay native confirm() để khớp theme. */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Xoá tin nhắn?"
        description="Tin nhắn sẽ ẩn khỏi mọi người trong channel. Hành động này không hoàn tác được."
        confirmLabel="Xoá tin nhắn"
        variant="destructive"
        onConfirm={deleteMsg}
      />
    </li>
  );
}

function Attachment({ att }: { att: NonNullable<Message['attachments']>[number] }) {
  if (att.type === 'image') {
    return (
      <a href={att.url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={att.url}
          alt={att.name}
          className="max-h-[300px] max-w-[400px] rounded-md border object-cover"
          loading="lazy"
        />
      </a>
    );
  }
  if (att.type === 'video') {
    return (
      <video
        src={att.url}
        controls
        className="max-h-[300px] max-w-[400px] rounded-md border"
        preload="metadata"
      />
    );
  }
  if (att.type === 'audio') {
    return <audio src={att.url} controls className="max-w-[400px]" preload="metadata" />;
  }
  // File: download link
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs hover:bg-accent"
      download={att.name}
    >
      <span className="truncate max-w-[280px]">{att.name}</span>
      <span className="text-muted-foreground">{Math.round(att.size / 1024)}KB</span>
    </a>
  );
}
