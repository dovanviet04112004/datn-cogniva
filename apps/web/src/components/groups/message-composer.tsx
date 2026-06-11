/**
 * MessageComposer — textarea + send button.
 *
 * Behavior:
 *   - Enter → send, Shift+Enter → newline
 *   - ANNOUNCEMENT: chỉ ADMIN+ post (disable input + show hint)
 *   - Slow mode cooldown: nếu 429 retry-after → block input + countdown
 */
'use client';

import * as React from 'react';
import { Send, Reply, X, Paperclip, Image as ImageIcon, FileText, Music, Video, Loader2, Smile } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { can, type GroupRole } from '@/lib/group/permissions';
import type { StudyGroupChannel } from '@cogniva/db';

import type { Message } from './message-item';
import { SlashMenu } from './slash-menu';
import { useEmitTyping } from './typing-indicator';
import { EmojiPicker } from './emoji-picker';
import { executeSlash } from '@/lib/group/slash-commands';
import { useMe } from '@/lib/use-me';

type Attachment = {
  type: 'image' | 'file' | 'audio' | 'video';
  url: string;
  name: string;
  size: number;
  mime: string;
};

type Props = {
  channel: StudyGroupChannel;
  myRole: GroupRole;
  replyingTo?: Message | null;
  onClearReply?: () => void;
};

export function MessageComposer({ channel, myRole, replyingTo, onClearReply }: Props) {
  const { data: me } = useMe();
  const [content, setContent] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [uploading, setUploading] = React.useState(0);
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // V2 quick win 3: emit typing event (debounce 3s) khi user gõ trong textarea.
  const notifyTyping = useEmitTyping(channel.groupId, channel.id);

  /** Chèn emoji vào textarea ở vị trí cursor (không append cuối). */
  const insertEmoji = React.useCallback((e: string) => {
    setEmojiOpen(false);
    const ta = textareaRef.current;
    if (!ta) {
      setContent((c) => c + e);
      return;
    }
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? content.length;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const next = before + e + after;
    setContent(next);
    // Restore focus + cursor sau emoji
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + e.length;
      ta.setSelectionRange(pos, pos);
    });
  }, [content]);

  // Cooldown timer
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Quyền post
  const canPost = (() => {
    if (channel.type === 'VOICE' || channel.type === 'STAGE') return false;
    if (channel.type === 'ANNOUNCEMENT') return can(myRole, 'group.update-meta');
    return can(myRole, 'message.send');
  })();

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

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // reset để có thể chọn lại cùng file
    if (attachments.length + files.length > 10) {
      toast.error('Max 10 file/tin nhắn');
      return;
    }
    for (const f of files) {
      await uploadFile(f);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const send = async () => {
    const rawText = content.trim();
    // V2 G7.3: Discord-style slash command — transform client-side trước khi POST.
    // Server vẫn nhận text bình thường (server-agnostic).
    const transformed = executeSlash(rawText, {
      userName: me?.name ?? 'someone',
    });
    const text = transformed ?? rawText;
    if ((!text && attachments.length === 0) || sending || cooldown > 0) return;
    if (uploading > 0) {
      toast.error('Đang upload, chờ xong rồi gửi');
      return;
    }
    // V2 G2.4 optimistic: clear textarea + attachments + reply state NGAY
    // trước khi await. Nếu fail → restore content (attachments không restore
    // vì đã upload xong; tạm chấp nhận loss để giữ UX nhanh). Realtime
    // `message:new` từ server sẽ append vào list — không cần optimistic insert.
    const snapshotContent = content;
    const snapshotAttachments = attachments;
    const snapshotReplyId = replyingTo?.id ?? undefined;
    setContent('');
    setAttachments([]);
    onClearReply?.();
    textareaRef.current?.focus();
    setSending(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          replyToId: snapshotReplyId,
          attachments: snapshotAttachments.length > 0 ? snapshotAttachments : undefined,
        }),
      });
      if (res.status === 429) {
        const d = await res.json().catch(() => null);
        const wait = d?.retryAfter ?? 5;
        setCooldown(wait);
        toast.error(`Slow mode — chờ ${wait}s`);
        // Restore content cho user retry sau cooldown
        setContent(snapshotContent);
        setAttachments(snapshotAttachments);
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? `status ${res.status}`);
      }
      // Nếu chứa @AI, fire AI reply background (giữ logic cũ).
      if (/(^|\s)@AI(\s|$|[?!.,])/i.test(text)) {
        const created = (await res.clone().json().catch(() => null)) as
          | { message?: { id: string } }
          | null;
        if (created?.message?.id) {
          fetch(`/api/channels/${channel.id}/ai-reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalMessageId: created.message.id, prompt: text }),
          })
            .then(async (r) => {
              if (!r.ok) {
                const d = await r.json().catch(() => null);
                toast.error('AI: ' + (d?.error ?? `status ${r.status}`));
              }
            })
            .catch((err) => toast.error('AI: ' + (err as Error).message));
        }
      }
    } catch (err) {
      toast.error('Gửi thất bại: ' + (err as Error).message);
      // Restore content + attachments để user retry (composer giờ rỗng vì
      // optimistic clear ở đầu hàm)
      setContent(snapshotContent);
      setAttachments(snapshotAttachments);
    } finally {
      setSending(false);
    }
  };

  // Auto-resize textarea
  React.useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [content]);

  if (channel.type === 'VOICE' || channel.type === 'STAGE') {
    return null;
  }

  // Replace last line `/cmd ...` với text user pick từ slash menu
  const handleSlashPick = (replacement: string) => {
    const lines = content.split('\n');
    lines[lines.length - 1] = replacement;
    setContent(lines.join('\n') + ' ');
    textareaRef.current?.focus();
  };

  return (
    <div className="relative shrink-0 bg-background px-3 pb-4 pt-2 sm:px-4 lg:px-6">
      {/* Cùng cap width + canh trái với message list (text-channel) → mép composer
          thẳng hàng mép tin nhắn, không lệch. */}
      <div className="max-w-screen-2xl">
        {/* Slash menu */}
        {canPost && <SlashMenu content={content} onPick={handleSlashPick} />}

        {/* Reply chip — pill subtle với corner indicator */}
        {replyingTo && canPost && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-divider bg-surface-secondary/60 px-3 py-2 text-xs">
            <Reply className="h-3 w-3 shrink-0 text-primary" />
            <span className="text-text-muted">Đang trả lời</span>
            <span className="font-semibold tracking-tight">
              {replyingTo.authorName ?? 'Anonymous'}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {replyingTo.content}
            </span>
            <button
              type="button"
              onClick={onClearReply}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Bỏ trả lời"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {!canPost ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-secondary/40 py-3 text-center text-xs text-muted-foreground">
            {channel.type === 'ANNOUNCEMENT'
              ? 'Chỉ ADMIN+ post được trong channel ANNOUNCEMENT'
              : 'Bạn không có quyền gửi tin nhắn'}
          </div>
        ) : (
          <>
            {/* Attachment preview chips */}
            {(attachments.length > 0 || uploading > 0) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a, i) => (
                  <AttachmentChip
                    key={i}
                    attachment={a}
                    onRemove={() => removeAttachment(i)}
                  />
                ))}
                {uploading > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Upload {uploading}...
                  </span>
                )}
              </div>
            )}

            {/* Composer row — 1 thanh bo tròn, TẤT CẢ nút nằm TRONG khung (đính kèm
                + emoji bên trái, gửi bên phải) như Discord, không để lòi ra ngoài
                lệch tông. focus-within highlight cả thanh khi gõ. */}
            <div className="relative flex items-end gap-1 rounded-3xl border border-divider bg-surface py-1 pl-2 pr-1.5 shadow-soft transition-all duration-base focus-within:border-primary/40 focus-within:shadow-glow">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || attachments.length >= 10}
                aria-label="Đính kèm file"
                title="Đính kèm (max 25MB)"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Paperclip className="h-[18px] w-[18px]" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={onPickFiles}
              />

              {/* Emoji picker button + floating panel */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setEmojiOpen((s) => !s)}
                  disabled={sending}
                  aria-label="Chèn emoji"
                  title="Emoji"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <Smile className="h-[18px] w-[18px]" />
                </button>
                {emojiOpen && (
                  <div className="absolute bottom-12 left-0 z-20">
                    <EmojiPicker
                      onSelect={insertEmoji}
                      onClose={() => setEmojiOpen(false)}
                    />
                  </div>
                )}
              </div>

                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    // Fire typing event mỗi keystroke; hook tự debounce 3s.
                    if (e.target.value.length > 0) notifyTyping();
                  }}
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
                    // Ctrl+V file/ảnh từ clipboard → upload như paperclip.
                    // Text paste vẫn để browser xử lý mặc định (không preventDefault).
                    const files = Array.from(e.clipboardData.files);
                    if (files.length === 0) return;
                    e.preventDefault();
                    if (attachments.length + files.length > 10) {
                      toast.error('Max 10 file/tin nhắn');
                      return;
                    }
                    for (const f of files) void uploadFile(f);
                  }}
                  placeholder={
                    cooldown > 0
                      ? `Slow mode — chờ ${cooldown}s`
                      : `Tin nhắn tới #${channel.name}`
                  }
                  disabled={sending || cooldown > 0}
                  rows={1}
                  className="block max-h-[140px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed outline-none placeholder:text-text-muted disabled:opacity-50"
                />

              <Button
                type="button"
                onClick={send}
                disabled={
                  (!content.trim() && attachments.length === 0) ||
                  sending ||
                  cooldown > 0 ||
                  uploading > 0
                }
                aria-label="Gửi"
                className="h-9 w-9 shrink-0 rounded-full p-0"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-[16px] w-[16px]" strokeWidth={2.25} />
                )}
              </Button>
            </div>
          </>
        )}

        {channel.slowModeSeconds ? (
          <p className="mt-1.5 text-center font-mono text-[10.5px] tabular-nums text-text-muted">
            Slow mode: {channel.slowModeSeconds}s giữa 2 tin
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const Icon =
    attachment.type === 'image'
      ? ImageIcon
      : attachment.type === 'audio'
        ? Music
        : attachment.type === 'video'
          ? Video
          : FileText;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-xs">
      {attachment.type === 'image' ? (
        <img
          src={attachment.url}
          alt={attachment.name}
          className="h-8 w-8 rounded object-cover"
        />
      ) : (
        <Icon className="h-4 w-4 text-muted-foreground" />
      )}
      <span className="max-w-[120px] truncate">{attachment.name}</span>
      <button
        onClick={onRemove}
        className="rounded p-0.5 hover:bg-accent"
        aria-label="Xoá"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
