'use client';

import * as React from 'react';
import {
  Send,
  Reply,
  X,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Music,
  Video,
  Loader2,
  Smile,
} from 'lucide-react';
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
  const notifyTyping = useEmitTyping(channel.groupId, channel.id);

  const insertEmoji = React.useCallback(
    (e: string) => {
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
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + e.length;
        ta.setSelectionRange(pos, pos);
      });
    },
    [content],
  );

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

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
    e.target.value = '';
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
    const transformed = executeSlash(rawText, {
      userName: me?.name ?? 'someone',
    });
    const text = transformed ?? rawText;
    if ((!text && attachments.length === 0) || sending || cooldown > 0) return;
    if (uploading > 0) {
      toast.error('Đang upload, chờ xong rồi gửi');
      return;
    }
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
        setContent(snapshotContent);
        setAttachments(snapshotAttachments);
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? `status ${res.status}`);
      }
      if (/(^|\s)@AI(\s|$|[?!.,])/i.test(text)) {
        const created = (await res
          .clone()
          .json()
          .catch(() => null)) as { message?: { id: string } } | null;
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
      setContent(snapshotContent);
      setAttachments(snapshotAttachments);
    } finally {
      setSending(false);
    }
  };

  React.useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [content]);

  if (channel.type === 'VOICE' || channel.type === 'STAGE') {
    return null;
  }

  const handleSlashPick = (replacement: string) => {
    const lines = content.split('\n');
    lines[lines.length - 1] = replacement;
    setContent(lines.join('\n') + ' ');
    textareaRef.current?.focus();
  };

  return (
    <div className="bg-background relative shrink-0 px-3 pb-4 pt-2 sm:px-4 lg:px-6">
      <div className="max-w-screen-2xl">
        {canPost && <SlashMenu content={content} onPick={handleSlashPick} />}

        {replyingTo && canPost && (
          <div className="border-divider bg-surface-secondary/60 mb-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
            <Reply className="text-primary h-3 w-3 shrink-0" />
            <span className="text-text-muted">Đang trả lời</span>
            <span className="font-semibold tracking-tight">
              {replyingTo.authorName ?? 'Anonymous'}
            </span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate">
              {replyingTo.content}
            </span>
            <button
              type="button"
              onClick={onClearReply}
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded-md transition-colors"
              title="Bỏ trả lời"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {!canPost ? (
          <div className="border-border bg-surface-secondary/40 text-muted-foreground rounded-xl border border-dashed py-3 text-center text-xs">
            {channel.type === 'ANNOUNCEMENT'
              ? 'Chỉ ADMIN+ post được trong channel ANNOUNCEMENT'
              : 'Bạn không có quyền gửi tin nhắn'}
          </div>
        ) : (
          <>
            {(attachments.length > 0 || uploading > 0) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a, i) => (
                  <AttachmentChip key={i} attachment={a} onRemove={() => removeAttachment(i)} />
                ))}
                {uploading > 0 && (
                  <span className="bg-muted/50 text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Upload {uploading}...
                  </span>
                )}
              </div>
            )}

            <div className="border-divider bg-surface shadow-soft duration-base focus-within:border-primary/40 focus-within:shadow-glow relative flex items-end gap-1 rounded-3xl border py-1 pl-2 pr-1.5 transition-all">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || attachments.length >= 10}
                aria-label="Đính kèm file"
                title="Đính kèm (max 25MB)"
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
              >
                <Paperclip className="h-[18px] w-[18px]" />
              </button>
              <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setEmojiOpen((s) => !s)}
                  disabled={sending}
                  aria-label="Chèn emoji"
                  title="Emoji"
                  className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
                >
                  <Smile className="h-[18px] w-[18px]" />
                </button>
                {emojiOpen && (
                  <div className="absolute bottom-12 left-0 z-20">
                    <EmojiPicker onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} />
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
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
                  cooldown > 0 ? `Slow mode — chờ ${cooldown}s` : `Tin nhắn tới #${channel.name}`
                }
                disabled={sending || cooldown > 0}
                rows={1}
                className="placeholder:text-text-muted block max-h-[140px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed outline-none disabled:opacity-50"
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
          <p className="text-text-muted mt-1.5 text-center font-mono text-[10.5px] tabular-nums">
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
    <div className="bg-muted/50 flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
      {attachment.type === 'image' ? (
        <img src={attachment.url} alt={attachment.name} className="h-8 w-8 rounded object-cover" />
      ) : (
        <Icon className="text-muted-foreground h-4 w-4" />
      )}
      <span className="max-w-[120px] truncate">{attachment.name}</span>
      <button onClick={onRemove} className="hover:bg-accent rounded p-0.5" aria-label="Xoá">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
