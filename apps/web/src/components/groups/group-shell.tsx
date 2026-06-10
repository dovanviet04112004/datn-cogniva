/**
 * GroupShell — layout cho group detail. KHÔNG Discord-style rail.
 *
 * Cogniva pattern (Linear/Notion-inspired):
 *   - Col2 (260px): channel list với GROUP SWITCHER dropdown ở header
 *     (avatar hue-deterministic + group name + chevron) thay vì stack
 *     icons dọc 60px discord-rail.
 *   - Col3 (flex): channel content
 *   - Col4 (lg+, 240px): member sidebar
 *
 * Mobile: Col2 thành drawer trượt từ trái (hamburger button trong content).
 * Col4 mobile drawer phải.
 *
 * Group switcher: click group name header → dropdown list groups user joined
 * + link "Tạo group mới". Eliminate redundant /groups list page.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Hash,
  KeyRound,
  Megaphone,
  MoreVertical,
  PanelLeft,
  Plus,
  Radio,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import type { StudyGroup, StudyGroupChannel } from '@cogniva/db';

import { CreateChannelButton } from './create-channel-button';
import { CreateGroupDialog } from './create-group-dialog';
import { DensityProvider } from './density-context';
import { JoinGroupDialog } from './join-group-dialog';
import { GroupActionsMenu } from './group-actions-menu';
import { GroupSettings } from './group-settings';
import { MemberSidebar } from './member-sidebar';
import { PresenceProvider } from './presence-context';
import { UnreadProvider, useUnread } from './unread-context';
import { VoiceChannelMembers } from './voice-channel-members';
import { useEdgeSwipe } from '@/lib/group/use-edge-swipe';

type Category = { id: string; name: string; position: number };

type Props = {
  group: StudyGroup;
  channels: StudyGroupChannel[];
  categories?: Category[];
  myGroups: { id: string; name: string; iconUrl: string | null }[];
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  activeGroupId: string;
  currentUserId: string;
  children: React.ReactNode;
};

const TYPE_ICON = {
  TEXT: Hash,
  VOICE: Volume2,
  ANNOUNCEMENT: Megaphone,
  STAGE: Radio,
  FORUM: BookOpen,
} as const;

/** Hash deterministic string → HSL hue. Same group → same color avatar. */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 30 + (h % 310);
}

export function GroupShell({
  group,
  channels,
  categories,
  myGroups,
  myRole,
  activeGroupId,
  currentUserId,
  children,
}: Props) {
  return (
    <PresenceProvider groupId={group.id}>
      <UnreadProvider groupId={group.id} currentUserId={currentUserId}>
        <DensityProvider>
          <GroupShellInner
            group={group}
            channels={channels}
            categories={categories}
            myGroups={myGroups}
            myRole={myRole}
            activeGroupId={activeGroupId}
            currentUserId={currentUserId}
          >
            {children}
          </GroupShellInner>
        </DensityProvider>
      </UnreadProvider>
    </PresenceProvider>
  );
}

function GroupShellInner({
  group,
  channels,
  categories,
  myGroups,
  myRole,
  activeGroupId,
  currentUserId,
  children,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';
  const { unread } = useUnread();

  // Channel đang mở là voice/stage? → KHÔNG hiện member sidebar bên phải (voice
  // room đã hiện participant trong grid riêng + có sidebar chat/notes riêng nên
  // member sidebar group thừa & chỏi). Cũng dùng để style nút toggle theo header tối.
  const activeChannelId = pathname.split('/')[3] ?? '';
  const activeChannelType = channels.find((c) => c.id === activeChannelId)?.type ?? '';
  const inVoiceView = activeChannelType === 'VOICE' || activeChannelType === 'STAGE';

  const [navOpen, setNavOpen] = React.useState(false);
  const [memberOpen, setMemberOpen] = React.useState(false);
  // Cài đặt nhóm mở dạng MODAL overlay (không đổi route) → đóng modal KHÔNG
  // unmount channel đang xem, KHÔNG reload tin nhắn (giống Discord). settingsTab
  // cho phép mở thẳng tab cần (vd quick-action "Category" → tab Danh mục).
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<'overview' | 'categories'>('overview');
  const openSettings = React.useCallback((tab: 'overview' | 'categories' = 'overview') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
    setNavOpen(false);
  }, []);
  /**
   * Desktop collapse cho member sidebar (col 4) — persist localStorage.
   * Dùng `null` cho phase chưa hydrate để TRÁNH flash open→close khi user đã
   * close trước đó: SSR + first client render đều hide sidebar, useEffect mới
   * đọc localStorage rồi mới quyết định show/hide. Mặc định nếu chưa có pref
   * là OPEN (false) — match desktop UX phổ biến.
   */
  const [memberCollapsed, setMemberCollapsed] = React.useState<boolean | null>(null);
  const [collapsedCats, setCollapsedCats] = React.useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const v = localStorage.getItem('cogniva.group.member-sidebar.collapsed');
      setMemberCollapsed(v === '1');
    } catch {
      setMemberCollapsed(false);
    }
  }, []);

  const toggleMemberSidebar = React.useCallback(() => {
    setMemberCollapsed((prev) => {
      const next = !(prev ?? false);
      try {
        localStorage.setItem('cogniva.group.member-sidebar.collapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Auto-close drawer khi route đổi
  React.useEffect(() => {
    setNavOpen(false);
    setMemberOpen(false);
  }, [pathname]);

  // V2 G6.5: edge swipe trên mobile mở drawer (chỉ kích hoạt khi drawer đóng)
  useEdgeSwipe({
    enabled: !navOpen && !memberOpen,
    onSwipeFromLeft: () => setNavOpen(true),
    // Voice view không có member sidebar → vuốt phải không mở gì.
    onSwipeFromRight: inVoiceView ? undefined : () => setMemberOpen(true),
  });

  const isVoiceLike = (t: string) => t === 'VOICE' || t === 'STAGE';

  // Nút toggle nổi: PHẲNG + canh giữa theo header h-12 (top-2.5) để THẲNG HÀNG +
  // đồng tông với các icon action phẳng trong header (bỏ box/border/shadow cho hết
  // "lạc quẻ"). Voice (header tối) → icon trắng; còn lại → muted theo theme.
  const floatBtnClass = (extra: string) =>
    cn(
      'absolute top-2.5 z-20 inline-flex items-center justify-center rounded p-1.5 transition-colors',
      inVoiceView
        ? 'text-white/70 hover:bg-white/10 hover:text-white'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      extra,
    );

  const onDropChannel = async (draggedChId: string, targetChId: string) => {
    const dragged = channels.find((c) => c.id === draggedChId);
    const target = channels.find((c) => c.id === targetChId);
    if (!dragged || !target || draggedChId === targetChId) return;
    try {
      const res = await fetch(`/api/groups/${group.id}/channels/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders: [{ id: draggedChId, position: target.position }],
        }),
      });
      if (!res.ok) throw new Error('Reorder thất bại');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // Override categoryId tạm thời (optimistic) → channel "nhảy" danh mục NGAY, không
  // chờ router.refresh() round-trip (hết delay trên PC). Server chốt sau, prop mới
  // khớp nên override giữ nguyên; lỗi thì revert.
  const [optimisticCat, setOptimisticCat] = React.useState<Record<string, string | null>>({});
  const effectiveCat = React.useCallback(
    (ch: StudyGroupChannel) => (ch.id in optimisticCat ? optimisticCat[ch.id] : ch.categoryId),
    [optimisticCat],
  );

  // Gán channel vào 1 danh mục (categoryId) hoặc bỏ ra (null). Optimistic + PATCH.
  const assignCategory = async (channelId: string, categoryId: string | null) => {
    const ch = channels.find((c) => c.id === channelId);
    if (!ch || effectiveCat(ch) === categoryId) return;
    setOptimisticCat((p) => ({ ...p, [channelId]: categoryId })); // chuyển NGAY
    try {
      const res = await fetch(`/api/groups/${group.id}/channels/${channelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error ?? 'Chuyển danh mục thất bại');
      }
      router.refresh();
    } catch (err) {
      setOptimisticCat((p) => {
        const n = { ...p };
        delete n[channelId];
        return n;
      });
      toast.error((err as Error).message);
    }
  };
  // Danh mục đang được kéo channel ngang qua → highlight. 'root' = vùng chưa phân loại.
  const [dragOverCat, setDragOverCat] = React.useState<string | null>(null);

  const toggleCat = (catId: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  // ChannelLink — row trong channel list, drag-drop reorder cho mod
  const renderChannelLink = (ch: StudyGroupChannel) => {
    const Icon = TYPE_ICON[ch.type];
    const href = `/groups/${group.id}/${ch.id}`;
    const active = pathname === href;
    const count = unread[ch.id] ?? 0;
    const hasUnread = !active && count > 0 && !isVoiceLike(ch.type);
    const isVoice = ch.type === 'VOICE';
    const canMoveCat = canManage && (categories ?? []).length > 0;
    return (
      <div key={ch.id} className="group/ch relative">
        <Link
          href={href}
          draggable={canManage}
          onDragStart={(e) => {
            if (!canManage) return;
            setDraggedId(ch.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (!canManage || !draggedId || draggedId === ch.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!canManage || !draggedId) return;
            onDropChannel(draggedId, ch.id);
            setDraggedId(null);
          }}
          onDragEnd={() => setDraggedId(null)}
          className={cn(
            'relative flex min-h-[34px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
            active
              ? 'bg-primary/10 text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            hasUnread && !active && 'font-semibold text-foreground',
            draggedId === ch.id && 'opacity-50',
            canMoveCat && 'pr-8', // chừa chỗ cho nút ⋮ (chuyển danh mục)
          )}
        >
          {active && (
            <span
              aria-hidden
              className="absolute -left-1 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary"
            />
          )}
          <Icon
            className={cn(
              'h-4 w-4 shrink-0',
              active ? 'text-primary' : 'text-text-muted',
            )}
            strokeWidth={active ? 2.25 : 1.75}
          />
          <span className="truncate">{ch.name}</span>
          {hasUnread && (
            <span className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold text-primary-foreground">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Link>
        {/* Nút ⋮ chuyển danh mục — hoạt động cả CẢM ỨNG (mobile) lẫn PC, thay cho
            kéo-thả (HTML5 drag không chạy trên touch). Hiện sẵn trên mobile, hover
            mới hiện trên desktop. */}
        {canMoveCat && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chuyển channel vào danh mục"
                className="absolute right-1 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded text-text-muted opacity-100 transition-opacity hover:bg-muted hover:text-foreground md:opacity-0 md:group-hover/ch:opacity-100"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-text-muted">
                Chuyển vào danh mục
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void assignCategory(ch.id, null)} className="gap-2">
                <span className="flex-1">Không phân loại</span>
                {!effectiveCat(ch) && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {(categories ?? []).map((cat) => (
                <DropdownMenuItem
                  key={cat.id}
                  onClick={() => void assignCategory(ch.id, cat.id)}
                  className="gap-2"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="flex-1 truncate">{cat.name}</span>
                  {effectiveCat(ch) === cat.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* Discord-style nested participants list — fetch + subscribe presence
            qua realtime (Socket.IO), ẩn nếu chưa có ai. */}
        {isVoice && (
          <VoiceChannelMembers
            groupId={group.id}
            channelId={ch.id}
            currentUserId={currentUserId}
          />
        )}
      </div>
    );
  };

  const uncategorized = channels.filter((c) => !effectiveCat(c));
  const byCategory: Record<string, StudyGroupChannel[]> = {};
  for (const ch of channels) {
    const cat = effectiveCat(ch);
    if (!cat) continue;
    (byCategory[cat] ??= []).push(ch);
  }

  const groupHue = hueFromString(group.name || group.id);
  const groupInitial = (group.name[0] ?? '?').toUpperCase();

  // ── Col 2 body — Group switcher header + channel scroll + user footer ──
  const channelListBody = (
    <>
      {/* Header: Group switcher dropdown. pr-12 mobile chừa chỗ cho nút X đóng
          drawer (absolute right-2) → không đè lên gear settings. md:pr-3 desktop
          (Col2 desktop không có nút X). */}
      <div className="flex h-14 items-center gap-2 border-b border-divider pl-3 pr-12 md:pr-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group/sw flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
              aria-label="Đổi group"
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tracking-tight ring-1 ring-inset"
                style={{
                  backgroundColor: `hsl(${groupHue} 70% 55% / 0.12)`,
                  color: `hsl(${groupHue} 60% 35%)`,
                  boxShadow: `inset 0 0 0 1px hsl(${groupHue} 70% 55% / 0.2)`,
                }}
              >
                {group.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={group.iconUrl}
                    alt={group.name}
                    className="h-8 w-8 rounded-lg object-cover"
                  />
                ) : (
                  groupInitial
                )}
              </div>
              <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold tracking-tight">
                {group.name}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted transition-colors group-hover/sw:text-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              Group của bạn
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {myGroups.map((g) => {
              const isActive = g.id === activeGroupId;
              const hue = hueFromString(g.name || g.id);
              const initial = (g.name[0] ?? '?').toUpperCase();
              return (
                <DropdownMenuItem
                  key={g.id}
                  asChild
                  className={cn('gap-2.5', isActive && 'bg-primary/5')}
                >
                  <Link href={`/groups/${g.id}`}>
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tracking-tight ring-1 ring-inset"
                      style={{
                        backgroundColor: `hsl(${hue} 70% 55% / 0.12)`,
                        color: `hsl(${hue} 60% 35%)`,
                        boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 55% / 0.2)`,
                      }}
                    >
                      {g.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.iconUrl}
                          alt={g.name}
                          className="h-7 w-7 rounded-md object-cover"
                        />
                      ) : (
                        initial
                      )}
                    </div>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm',
                        isActive && 'font-semibold',
                      )}
                    >
                      {g.name}
                    </span>
                    {isActive && (
                      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-primary">
                        đang ở
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            {/* Actions — custom trigger rows fit dropdown width */}
            <JoinGroupDialog
              trigger={
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <KeyRound className="h-4 w-4 text-text-muted" />
                  Tham gia bằng code
                </button>
              }
            />
            <CreateGroupDialog
              trigger={
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <Plus className="h-4 w-4 text-text-muted" />
                  Tạo group mới
                </button>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Nút ⚙ cho MỌI member: mời (code/link), cài đặt (admin), rời nhóm. */}
        <GroupActionsMenu
          groupId={group.id}
          groupName={group.name}
          myRole={myRole}
          currentUserId={currentUserId}
          onOpenSettings={canManage ? () => openSettings('overview') : undefined}
        />
      </div>

      {/* Channel list scroll */}
      <ScrollArea className="flex-1">
        <div className="space-y-4 px-2 py-4">
          {/* Uncategorized — TEXT trước, VOICE/STAGE sau. Cũng là drop target để
              KÉO channel RA khỏi danh mục (categoryId=null). */}
          {uncategorized.length > 0 && (
            <div
              onDragOver={(e) => {
                if (!canManage || !draggedId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverCat('root');
              }}
              onDragLeave={() => setDragOverCat((c) => (c === 'root' ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverCat(null);
                if (!canManage || !draggedId) return;
                void assignCategory(draggedId, null);
                setDraggedId(null);
              }}
              className={cn(
                'space-y-0.5 rounded-md',
                dragOverCat === 'root' && 'ring-2 ring-inset ring-primary/50 bg-primary/5',
              )}
            >
              {uncategorized
                .filter((c) => !isVoiceLike(c.type))
                .map((c) => renderChannelLink(c))}
              {uncategorized
                .filter((c) => isVoiceLike(c.type))
                .map((c) => renderChannelLink(c))}
            </div>
          )}

          {/* Categories — collapsible + kéo-thả channel vào để gán (mod) */}
          {(categories ?? []).map((cat) => {
            const items = byCategory[cat.id] ?? [];
            const collapsed = collapsedCats.has(cat.id);
            return (
              <div
                key={cat.id}
                onDragOver={(e) => {
                  if (!canManage || !draggedId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverCat(cat.id);
                }}
                onDragLeave={() => setDragOverCat((c) => (c === cat.id ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCat(null);
                  if (!canManage || !draggedId) return;
                  void assignCategory(draggedId, cat.id);
                  setDraggedId(null);
                }}
                className={cn(
                  'space-y-0.5 rounded-md',
                  dragOverCat === cat.id && 'ring-2 ring-inset ring-primary/50 bg-primary/5',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleCat(cat.id)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/40"
                >
                  {collapsed ? (
                    <ChevronRight className="h-3 w-3 text-text-muted" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-text-muted" />
                  )}
                  <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    {cat.name}
                  </span>
                </button>
                {!collapsed && (
                  <div className="space-y-0.5">
                    {items.map((c) => renderChannelLink(c))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Quick actions cho mod — bo radius hơn, tone subtle */}
          {canManage && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-divider pt-3">
              <CreateChannelButton groupId={group.id} type="TEXT">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-muted hover:text-foreground">
                  <Plus className="h-3 w-3" />
                  Text
                </span>
              </CreateChannelButton>
              <CreateChannelButton groupId={group.id} type="VOICE">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-muted hover:text-foreground">
                  <Plus className="h-3 w-3" />
                  Voice
                </span>
              </CreateChannelButton>
              <CreateChannelButton groupId={group.id} type="STAGE">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-muted hover:text-foreground">
                  <Plus className="h-3 w-3" />
                  Stage
                </span>
              </CreateChannelButton>
              <CreateChannelButton groupId={group.id} type="FORUM">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-muted hover:text-foreground">
                  <Plus className="h-3 w-3" />
                  Forum
                </span>
              </CreateChannelButton>
              <button
                type="button"
                onClick={() => openSettings('categories')}
                className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-muted hover:text-foreground"
              >
                <Folder className="h-3 w-3" />
                Category
              </button>
            </div>
          )}

          {channels.length === 0 && (
            <p className="px-2 text-xs text-text-muted">Chưa có channel nào</p>
          )}
        </div>
      </ScrollArea>
      <UserFooter />
    </>
  );

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      {/* ── Col 2: Channel list (desktop md+) — không còn Col1 rail Discord ── */}
      <aside className="hidden h-full w-[260px] shrink-0 flex-col border-r border-divider bg-surface-secondary/50 md:flex">
        {channelListBody}
      </aside>

      {/* ── Col 2 mobile drawer ── */}
      {navOpen && (
        <div
          role="presentation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-divider bg-surface-secondary shadow-elevated transition-transform md:hidden',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Đóng channel list"
          className="absolute right-2 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        {channelListBody}
      </aside>

      {/* ── Col 3: Channel view ── */}
      <main className="relative flex h-full min-w-0 flex-1 flex-col bg-background">
        {/* Mobile: nút mở channel list — icon PanelLeft (KHÁC ≡ Menu của app
            sidebar trên topbar) để 2 nút không nhìn y hệt nhau, đỡ nhầm. */}
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Mở danh sách kênh"
          title="Danh sách kênh"
          className={floatBtnClass('left-3 md:hidden')}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        {/* Nút toggle member sidebar — ẨN trong voice view (voice room tự hiện
            participant + không có member sidebar bên phải). */}
        {!inVoiceView && (
          <>
            {/* Mobile */}
            <button
              type="button"
              onClick={() => setMemberOpen(true)}
              aria-label="Mở danh sách thành viên"
              className={floatBtnClass('right-3 lg:hidden')}
            >
              <Users className="h-4 w-4" />
            </button>
            {/* Desktop: toggle col 4 collapse. z-20 để nổi trên header sticky (z-10). */}
            <button
              type="button"
              onClick={toggleMemberSidebar}
              aria-label={memberCollapsed ? 'Mở thành viên nhóm' : 'Đóng thành viên nhóm'}
              title={memberCollapsed ? 'Mở thành viên nhóm' : 'Đóng thành viên nhóm'}
              className={floatBtnClass('right-3 hidden lg:inline-flex')}
            >
              <Users className="h-4 w-4" />
            </button>
          </>
        )}
        {group.suspendedAt && (
          <div className="border-b border-red-500/40 bg-red-500/10 px-4 py-2.5 text-[12.5px] text-red-700 dark:text-red-300">
            <p className="font-semibold">⚠ Group đang bị tạm khoá bởi ban quản trị</p>
            {group.suspendReason && (
              <p className="mt-0.5 text-[11.5px] opacity-90">
                Lý do: {group.suspendReason}
              </p>
            )}
            <p className="mt-0.5 text-[11px] opacity-75">
              Bạn vẫn xem được lịch sử nhưng không gửi được tin nhắn mới. Liên
              hệ admin nếu cần khiếu nại.
            </p>
          </div>
        )}
        {children}
      </main>

      {/* Member sidebar (desktop col4 + mobile drawer) — ẨN HẲN khi đang ở voice
          channel (voice room tự hiện participant, không cần member sidebar phải). */}
      {!inVoiceView && (
        <>
      {/* ── Col 4: Group member sidebar (desktop lg+). Animate WIDTH thay vì
           mount/unmount snap → đóng/mở mượt như Discord. memberCollapsed === null
           (chưa hydrate) coi như MỞ (đúng intent "default open"); effect đọc
           localStorage rồi CSS tự transition. ── */}
      <div
        className={cn(
          'hidden h-full shrink-0 overflow-hidden transition-[width] duration-base ease-soft-out lg:block',
          memberCollapsed === true ? 'w-0' : 'w-[220px]',
        )}
        aria-hidden={memberCollapsed === true}
      >
        <MemberSidebar groupId={group.id} myRole={myRole} />
      </div>

      {/* ── Col 4 mobile drawer ── */}
      {memberOpen && (
        <div
          role="presentation"
          onClick={() => setMemberOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/30 lg:hidden"
        />
      )}
      <div
        className={cn(
          // bg-surface-secondary: MemberSidebar dùng bg-muted/20 (20%) → drawer
          // fixed bị lộ nền sau (trong suốt). Thêm nền đặc + shadow như Col2.
          'fixed inset-y-0 right-0 z-50 flex w-[260px] border-l border-divider bg-surface-secondary shadow-elevated transition-transform lg:hidden',
          memberOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={() => setMemberOpen(false)}
          aria-label="Đóng danh sách thành viên"
          className="absolute left-2 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
        <MemberSidebar groupId={group.id} myRole={myRole} forceVisible />
      </div>
        </>
      )}

      {/* Cài đặt nhóm — MODAL overlay (admin+), mount sẵn nhưng chỉ fetch khi mở.
          Đóng = setSettingsOpen(false), KHÔNG đổi route → channel/tin nhắn giữ nguyên. */}
      {canManage && (
        <GroupSettings
          groupId={group.id}
          myRole={myRole === 'OWNER' ? 'OWNER' : 'ADMIN'}
          currentUserId={currentUserId}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialTab={settingsTab}
        />
      )}
    </div>
  );
}

function UserFooter() {
  // Dùng useSession hook của Better Auth thay vì fetch raw endpoint.
  // Endpoint `/api/auth/session` không tồn tại — Better Auth dùng catchall
  // `[...all]` với action `/api/auth/get-session`. useSession() wrap đúng.
  const { data: session } = useSession();
  // Mounted guard chống hydration mismatch: SSR `session=null` (render null) ≠
  // client render đầu có user từ cache (render div) → lệch. Giữ null ở render
  // đầu (khớp SSR), sau mount mới hiện footer.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const me = mounted ? session?.user : null;
  if (!me) return null;
  return (
    <div className="flex h-12 items-center gap-2.5 border-t border-divider bg-card/40 px-3">
      <Avatar className="h-7 w-7">
        <AvatarImage src={me.image ?? undefined} />
        <AvatarFallback className="text-xs">
          {(me.name ?? 'U')[0]}
        </AvatarFallback>
      </Avatar>
      <span className="flex-1 truncate text-xs font-medium tracking-tight">
        {me.name ?? 'Bạn'}
      </span>
    </div>
  );
}
