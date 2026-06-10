/**
 * ForumChannel — Discord forum style: mỗi post = thread riêng.
 *
 * 2 view trong cùng component (state-driven):
 *   - 'list'  : list post cards + filter tag + nút "Post mới"
 *   - 'post'  : 1 post detail + reply list + reply composer
 *
 * Layout post card: title (lớn) + author + tags chips + replyCount + lastActivity.
 * Sort: pinned trước, sau đó thread_last_at DESC.
 *
 * Tag filter: click chip → fetch lại list với ?tag=X.
 * New post: dialog với title + content + multi-select tags từ channel.availableTags.
 */
'use client';

import * as React from 'react';
import {
  ArrowDownAZ,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  MessageSquare,
  Pin,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { useRealtimeInvalidate } from '@/lib/query/use-realtime-query';
import type { StudyGroupChannel } from '@cogniva/db';

import { ThreadPanel } from './thread-panel';
import { can, type GroupRole } from '@/lib/group/permissions';

type SortOption = 'latest' | 'newest' | 'replies';
const SORT_META: Record<SortOption, { label: string; icon: typeof Clock }> = {
  latest: { label: 'Hoạt động gần nhất', icon: Clock },
  newest: { label: 'Mới nhất', icon: ArrowDownAZ },
  replies: { label: 'Nhiều reply nhất', icon: MessageSquare },
};

type Tag = { name: string; color?: string };

type ForumPost = {
  id: string;
  title: string | null;
  content: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  tags: string[] | null;
  replyCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  pinned: boolean;
  /** V2 G5.4: true nếu thread đã có 1 reply được mark solution. */
  hasSolution?: boolean;
};

type Props = {
  channel: StudyGroupChannel;
  myRole: GroupRole;
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
};

/** Response list forum từ API (theo channel + sort + tag). */
type ForumResponse = { posts: ForumPost[]; availableTags: Tag[] };

export function ForumChannel({ channel, myRole, currentUserId }: Props) {
  const qc = useQueryClient();
  const [activeTag, setActiveTag] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<SortOption>('latest');
  const [activePostId, setActivePostId] = React.useState<string | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [tagMgrOpen, setTagMgrOpen] = React.useState(false);

  const canPost = can(myRole, 'message.send');
  const canManageTags = can(myRole, 'channel.update');

  // ── React Query: list forum theo (channel, sort, tag). Vào lại forum / đổi filter
  //    đã xem → hiện NGAY từ cache (persist IndexedDB), revalidate ngầm. ──
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.forum(channel.id, sort, activeTag),
    queryFn: () => {
      const url = new URL(`/api/channels/${channel.id}/forum`, window.location.origin);
      if (activeTag) url.searchParams.set('tag', activeTag);
      if (sort !== 'latest') url.searchParams.set('sort', sort);
      return apiGet<ForumResponse>(url.toString());
    },
  });
  const posts = data?.posts ?? [];
  // Tag chips: ưu tiên list từ server, fallback prop channel khi chưa load.
  const availableTags = data?.availableTags ?? (channel.availableTags as Tag[] | null) ?? [];

  // Invalidate mọi view forum của channel (mọi sort/tag) → dùng sau khi tạo post.
  const invalidateForum = React.useCallback(
    () => qc.invalidateQueries({ queryKey: ['channel', channel.id, 'forum'] }),
    [qc, channel.id],
  );

  // Realtime: post/reply mới hoặc đánh dấu solution → refetch ngầm list.
  useRealtimeInvalidate(`private-channel-${channel.id}`, 'message:new', [
    ['channel', channel.id, 'forum'],
  ]);
  useRealtimeInvalidate(`private-channel-${channel.id}`, 'forum:solution', [
    ['channel', channel.id, 'forum'],
  ]);

  // Post detail view
  if (activePostId) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActivePostId(null)}
            className="h-7 gap-1 px-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="text-xs">Forum</span>
          </Button>
          <span className="text-sm font-semibold">{channel.name}</span>
        </header>
        <div className="min-h-0 flex-1">
          <ThreadPanel
            channelId={channel.id}
            rootMessageId={activePostId}
            onClose={() => setActivePostId(null)}
            forumContext={{ currentUserId, myRole }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b pl-12 pr-3 md:pl-4 md:pr-3 lg:pr-14">
        <BookOpen className="h-4 w-4 shrink-0 text-forum" />
        <span className="truncate font-semibold">{channel.name}</span>
        {channel.topic && (
          <>
            <span className="hidden h-4 w-px bg-border sm:block" />
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              {channel.topic}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* V2 G5.4: sort dropdown */}
          <SortDropdown sort={sort} onChange={setSort} />
          {canManageTags && (
            <Button
              onClick={() => setTagMgrOpen(true)}
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5"
              title="Quản lý tag"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden text-xs sm:inline">Tags</span>
            </Button>
          )}
          {canPost && (
            <Button onClick={() => setNewOpen(true)} size="sm" className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              <span className="text-xs">Post mới</span>
            </Button>
          )}
        </div>
      </header>

      {/* Tag filter row */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
          <button
            onClick={() => setActiveTag(null)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition',
              !activeTag
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
          >
            Tất cả
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag.name}
              onClick={() => setActiveTag(tag.name === activeTag ? null : tag.name)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition',
                activeTag === tag.name
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {loading ? (
          <ForumSkeleton />
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {activeTag ? `Không có post nào với tag #${activeTag}` : 'Chưa có post nào'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {canPost ? 'Bấm "Post mới" để bắt đầu thảo luận.' : 'Đợi mod tạo post đầu tiên.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {posts.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setActivePostId(p.id)}
                  className="group block w-full rounded-lg border bg-card p-3 text-left transition hover:border-foreground/20 hover:shadow-md sm:p-4"
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={p.authorImage ?? undefined} />
                      <AvatarFallback className="text-xs">
                        {(p.authorName ?? '?')[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.pinned && (
                          <Pin className="h-3 w-3 shrink-0 text-amber-500" />
                        )}
                        <h3 className="truncate text-sm font-semibold sm:text-base">
                          {p.title ?? '(Không tiêu đề)'}
                        </h3>
                        {/* V2 G5.4: Solved badge */}
                        {p.hasSolution && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-forum/15 px-1.5 py-0.5 text-[10px] font-semibold text-forum">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Đã giải đáp
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.authorName ?? 'Anonymous'} ·{' '}
                        {fmtRelative(p.lastActivityAt ?? p.createdAt)}
                      </p>
                      {p.content && (
                        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground sm:text-sm">
                          {p.content}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {(p.tags ?? []).map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            #{t}
                          </span>
                        ))}
                        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MessageSquare className="h-3 w-3" />
                          {p.replyCount}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewPostDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        channelId={channel.id}
        availableTags={availableTags}
        onCreated={(postId) => {
          setNewOpen(false);
          invalidateForum();
          setActivePostId(postId);
        }}
      />
      {canManageTags && (
        <TagManagerDialog
          open={tagMgrOpen}
          onOpenChange={setTagMgrOpen}
          groupId={channel.groupId}
          channelId={channel.id}
          tags={availableTags}
          onSaved={(newTags) => {
            // Nếu activeTag bị xoá → clear filter, rồi refetch list (lấy availableTags mới).
            if (activeTag && !newTags.find((t) => t.name === activeTag)) {
              setActiveTag(null);
            }
            invalidateForum();
          }}
        />
      )}
    </div>
  );
}

/**
 * ForumSkeleton — V2 G6.4: 4 row placeholder để giảm layout shift khi load.
 */
function ForumSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <div className="rounded-lg border bg-card p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-4 w-12 rounded-full" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * SortDropdown — V2 G5.4: chọn sort order cho forum post list.
 * Cookie KHÔNG persist (per-session intent). Default = 'latest'.
 */
function SortDropdown({
  sort,
  onChange,
}: {
  sort: SortOption;
  onChange: (s: SortOption) => void;
}) {
  const ActiveIcon = SORT_META[sort].icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          title={`Sort: ${SORT_META[sort].label}`}
        >
          <ActiveIcon className="h-3.5 w-3.5" />
          <span className="hidden text-xs sm:inline">{SORT_META[sort].label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {(['latest', 'newest', 'replies'] as SortOption[]).map((s) => {
          const meta = SORT_META[s];
          const Icon = meta.icon;
          const active = s === sort;
          return (
            <DropdownMenuItem
              key={s}
              onClick={() => onChange(s)}
              className="flex items-center gap-2"
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 text-[12.5px]">{meta.label}</span>
              {active && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagManagerDialog({
  open,
  onOpenChange,
  groupId,
  channelId,
  tags,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
  channelId: string;
  tags: Tag[];
  onSaved: (tags: Tag[]) => void;
}) {
  const [local, setLocal] = React.useState<Tag[]>(tags);
  const [newName, setNewName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setLocal(tags);
  }, [open, tags]);

  const addTag = () => {
    const name = newName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;
    if (local.find((t) => t.name === name)) {
      toast.error('Tag đã tồn tại');
      return;
    }
    if (local.length >= 20) {
      toast.error('Max 20 tag/channel');
      return;
    }
    setLocal([...local, { name }]);
    setNewName('');
  };

  const removeTag = (name: string) => {
    setLocal(local.filter((t) => t.name !== name));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/channels/${channelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availableTags: local }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `status ${res.status}`);
      toast.success('Đã lưu tags');
      onSaved(local);
      onOpenChange(false);
    } catch (err) {
      toast.error('Lưu thất bại: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quản lý tags</DialogTitle>
          <DialogDescription>
            User pick tag khi tạo post. Max 20 tag/channel, 40 ký tự/tag.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Vd: bug, help, đề-thi"
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag();
              }}
            />
            <Button onClick={addTag} disabled={!newName.trim()} size="sm">
              Thêm
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 rounded-md border bg-muted/30 p-3 min-h-[60px]">
            {local.length === 0 ? (
              <p className="text-xs text-muted-foreground">Chưa có tag nào.</p>
            ) : (
              local.map((tag) => (
                <span
                  key={tag.name}
                  className="inline-flex items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs"
                >
                  #{tag.name}
                  <button
                    onClick={() => removeTag(tag.name)}
                    className="rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewPostDialog({
  open,
  onOpenChange,
  channelId,
  availableTags,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channelId: string;
  availableTags: Tag[];
  onCreated: (postId: string) => void;
}) {
  const [title, setTitle] = React.useState('');
  const [content, setContent] = React.useState('');
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTitle('');
      setContent('');
      setSelectedTags([]);
    }
  }, [open]);

  const toggleTag = (name: string) => {
    setSelectedTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name].slice(0, 5),
    );
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error('Cần tiêu đề');
      return;
    }
    if (!content.trim()) {
      toast.error('Cần nội dung');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `status ${res.status}`);
      onCreated(data.message.id);
    } catch (err) {
      toast.error('Tạo post thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo post mới</DialogTitle>
          <DialogDescription>
            Mỗi post tạo 1 thread riêng. Khác chat thông thường — phù hợp Q&A, thảo luận dài.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-title">Tiêu đề</Label>
            <Input
              id="p-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Vd: Cách giải bài 3.2 trang 42?"
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-content">Nội dung</Label>
            <textarea
              id="p-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="Mô tả chi tiết, paste link, kèm code..."
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {availableTags.length > 0 && (
            <div className="space-y-1.5">
              <Label>Tag ({selectedTags.length}/5)</Label>
              <div className="flex flex-wrap gap-1.5">
                {availableTags.map((tag) => {
                  const selected = selectedTags.includes(tag.name);
                  return (
                    <button
                      key={tag.name}
                      type="button"
                      onClick={() => toggleTag(tag.name)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-medium transition',
                        selected
                          ? 'bg-foreground text-background'
                          : 'bg-muted text-muted-foreground hover:bg-muted/70',
                      )}
                    >
                      {selected && <X className="mr-1 inline h-2.5 w-2.5" />}#{tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={submitting || !title.trim() || !content.trim()}>
            {submitting ? 'Đang tạo...' : 'Đăng post'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return 'vừa xong';
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} giờ trước`;
  if (sec < 604_800) return `${Math.floor(sec / 86_400)} ngày trước`;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
