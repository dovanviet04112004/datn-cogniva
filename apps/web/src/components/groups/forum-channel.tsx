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
  hasSolution?: boolean;
};

type Props = {
  channel: StudyGroupChannel;
  myRole: GroupRole;
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
};

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

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.forum(channel.id, sort, activeTag),
    queryFn: () => {
      const url = new URL(`/api/channels/${channel.id}/forum`, window.location.origin);
      if (activeTag) url.searchParams.set('tag', activeTag);
      if (sort !== 'latest') url.searchParams.set('sort', sort);
      return apiGet<ForumResponse>(url.toString());
    },
    refetchOnMount: 'always',
  });
  const posts = data?.posts ?? [];
  const availableTags = data?.availableTags ?? (channel.availableTags as Tag[] | null) ?? [];

  const invalidateForum = React.useCallback(
    () => qc.invalidateQueries({ queryKey: ['channel', channel.id, 'forum'] }),
    [qc, channel.id],
  );

  useRealtimeInvalidate(`private-channel-${channel.id}`, 'message:new', [
    ['channel', channel.id, 'forum'],
  ]);
  useRealtimeInvalidate(`private-channel-${channel.id}`, 'forum:solution', [
    ['channel', channel.id, 'forum'],
  ]);

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
        <BookOpen className="text-forum h-4 w-4 shrink-0" />
        <span className="truncate font-semibold">{channel.name}</span>
        {channel.topic && (
          <>
            <span className="bg-border hidden h-4 w-px sm:block" />
            <span className="text-muted-foreground hidden truncate text-xs sm:inline">
              {channel.topic}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
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
            <BookOpen className="text-muted-foreground/50 mb-3 h-10 w-10" />
            <p className="text-sm font-medium">
              {activeTag ? `Không có post nào với tag #${activeTag}` : 'Chưa có post nào'}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {canPost ? 'Bấm "Post mới" để bắt đầu thảo luận.' : 'Đợi mod tạo post đầu tiên.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {posts.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setActivePostId(p.id)}
                  className="bg-card hover:border-foreground/20 group block w-full rounded-lg border p-3 text-left transition hover:shadow-md sm:p-4"
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
                        {p.pinned && <Pin className="h-3 w-3 shrink-0 text-amber-500" />}
                        <h3 className="truncate text-sm font-semibold sm:text-base">
                          {p.title ?? '(Không tiêu đề)'}
                        </h3>
                        {p.hasSolution && (
                          <span className="bg-forum/15 text-forum inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Đã giải đáp
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {p.authorName ?? 'Anonymous'} ·{' '}
                        {fmtRelative(p.lastActivityAt ?? p.createdAt)}
                      </p>
                      {p.content && (
                        <p className="text-muted-foreground mt-1.5 line-clamp-2 text-xs sm:text-sm">
                          {p.content}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {(p.tags ?? []).map((t) => (
                          <span
                            key={t}
                            className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium"
                          >
                            #{t}
                          </span>
                        ))}
                        <span className="text-muted-foreground ml-auto flex items-center gap-1 text-[11px]">
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

function ForumSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <div className="bg-card rounded-lg border p-3 sm:p-4">
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

function SortDropdown({ sort, onChange }: { sort: SortOption; onChange: (s: SortOption) => void }) {
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
              <Icon className="text-muted-foreground h-3.5 w-3.5" />
              <span className="flex-1 text-[12.5px]">{meta.label}</span>
              {active && <Check className="text-primary h-3.5 w-3.5" />}
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
          <div className="bg-muted/30 flex min-h-[60px] flex-wrap gap-1.5 rounded-md border p-3">
            {local.length === 0 ? (
              <p className="text-muted-foreground text-xs">Chưa có tag nào.</p>
            ) : (
              local.map((tag) => (
                <span
                  key={tag.name}
                  className="bg-background inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                >
                  #{tag.name}
                  <button
                    onClick={() => removeTag(tag.name)}
                    className="hover:bg-destructive/20 hover:text-destructive rounded-full p-0.5"
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
              className="bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
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
