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
import { useMe } from '@/lib/use-me';
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

  const activeChannelId = pathname.split('/')[3] ?? '';
  const activeChannelType = channels.find((c) => c.id === activeChannelId)?.type ?? '';
  const inVoiceView = activeChannelType === 'VOICE' || activeChannelType === 'STAGE';

  const [navOpen, setNavOpen] = React.useState(false);
  const [memberOpen, setMemberOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<'overview' | 'categories'>('overview');
  const openSettings = React.useCallback((tab: 'overview' | 'categories' = 'overview') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
    setNavOpen(false);
  }, []);
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
      } catch {}
      return next;
    });
  }, []);

  React.useEffect(() => {
    setNavOpen(false);
    setMemberOpen(false);
  }, [pathname]);

  useEdgeSwipe({
    enabled: !navOpen && !memberOpen,
    onSwipeFromLeft: () => setNavOpen(true),
    onSwipeFromRight: inVoiceView ? undefined : () => setMemberOpen(true),
  });

  const isVoiceLike = (t: string) => t === 'VOICE' || t === 'STAGE';

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

  const [optimisticCat, setOptimisticCat] = React.useState<Record<string, string | null>>({});
  const effectiveCat = React.useCallback(
    (ch: StudyGroupChannel) => (ch.id in optimisticCat ? optimisticCat[ch.id] : ch.categoryId),
    [optimisticCat],
  );

  const assignCategory = async (channelId: string, categoryId: string | null) => {
    const ch = channels.find((c) => c.id === channelId);
    if (!ch || effectiveCat(ch) === categoryId) return;
    setOptimisticCat((p) => ({ ...p, [channelId]: categoryId }));
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
  const [dragOverCat, setDragOverCat] = React.useState<string | null>(null);

  const toggleCat = (catId: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

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
            hasUnread && !active && 'text-foreground font-semibold',
            draggedId === ch.id && 'opacity-50',
            canMoveCat && 'pr-8',
          )}
        >
          {active && (
            <span
              aria-hidden
              className="bg-primary absolute -left-1 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full"
            />
          )}
          <Icon
            className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-text-muted')}
            strokeWidth={active ? 2.25 : 1.75}
          />
          <span className="truncate">{ch.name}</span>
          {hasUnread && (
            <span className="bg-primary text-primary-foreground ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Link>
        {canMoveCat && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chuyển channel vào danh mục"
                className="text-text-muted hover:bg-muted hover:text-foreground absolute right-1 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded opacity-100 transition-opacity md:opacity-0 md:group-hover/ch:opacity-100"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-text-muted text-[11px] uppercase tracking-wider">
                Chuyển vào danh mục
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void assignCategory(ch.id, null)} className="gap-2">
                <span className="flex-1">Không phân loại</span>
                {!effectiveCat(ch) && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {(categories ?? []).map((cat) => (
                <DropdownMenuItem
                  key={cat.id}
                  onClick={() => void assignCategory(ch.id, cat.id)}
                  className="gap-2"
                >
                  <FolderOpen className="text-text-muted h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{cat.name}</span>
                  {effectiveCat(ch) === cat.id && <Check className="text-primary h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {isVoice && (
          <VoiceChannelMembers groupId={group.id} channelId={ch.id} currentUserId={currentUserId} />
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

  const channelListBody = (
    <>
      <div className="border-divider flex h-14 items-center gap-2 border-b pl-3 pr-12 md:pr-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group/sw hover:bg-muted/60 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors"
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
              <ChevronDown className="text-text-muted group-hover/sw:text-foreground h-3.5 w-3.5 shrink-0 transition-colors" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-text-muted text-[11px] font-semibold uppercase tracking-[0.14em]">
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
                      className={cn('min-w-0 flex-1 truncate text-sm', isActive && 'font-semibold')}
                    >
                      {g.name}
                    </span>
                    {isActive && (
                      <span className="text-primary font-mono text-[11px] uppercase tracking-[0.1em]">
                        đang ở
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <JoinGroupDialog
              trigger={
                <button
                  type="button"
                  className="text-foreground/80 hover:bg-muted/60 hover:text-foreground flex w-full items-center gap-2.5 px-2 py-1.5 text-sm transition-colors"
                >
                  <KeyRound className="text-text-muted h-4 w-4" />
                  Tham gia bằng code
                </button>
              }
            />
            <CreateGroupDialog
              trigger={
                <button
                  type="button"
                  className="text-foreground/80 hover:bg-muted/60 hover:text-foreground flex w-full items-center gap-2.5 px-2 py-1.5 text-sm transition-colors"
                >
                  <Plus className="text-text-muted h-4 w-4" />
                  Tạo group mới
                </button>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
        <GroupActionsMenu
          groupId={group.id}
          groupName={group.name}
          myRole={myRole}
          currentUserId={currentUserId}
          onOpenSettings={canManage ? () => openSettings('overview') : undefined}
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 px-2 py-4">
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
                dragOverCat === 'root' && 'ring-primary/50 bg-primary/5 ring-2 ring-inset',
              )}
            >
              {uncategorized.filter((c) => !isVoiceLike(c.type)).map((c) => renderChannelLink(c))}
              {uncategorized.filter((c) => isVoiceLike(c.type)).map((c) => renderChannelLink(c))}
            </div>
          )}

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
                  dragOverCat === cat.id && 'ring-primary/50 bg-primary/5 ring-2 ring-inset',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleCat(cat.id)}
                  className="hover:bg-muted/40 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors"
                >
                  {collapsed ? (
                    <ChevronRight className="text-text-muted h-3 w-3" />
                  ) : (
                    <ChevronDown className="text-text-muted h-3 w-3" />
                  )}
                  <span className="text-text-muted flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em]">
                    {cat.name}
                  </span>
                </button>
                {!collapsed && (
                  <div className="space-y-0.5">{items.map((c) => renderChannelLink(c))}</div>
                )}
              </div>
            );
          })}

          {canManage && (
            <div className="border-divider flex flex-wrap items-center gap-1.5 border-t pt-3">
              <CreateChannelButton groupId={group.id} type="TEXT">
                <span className="bg-muted/40 text-text-muted hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors">
                  <Plus className="h-3 w-3" />
                  Text
                </span>
              </CreateChannelButton>
              <CreateChannelButton groupId={group.id} type="VOICE">
                <span className="bg-muted/40 text-text-muted hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors">
                  <Plus className="h-3 w-3" />
                  Voice
                </span>
              </CreateChannelButton>
              <CreateChannelButton groupId={group.id} type="STAGE">
                <span className="bg-muted/40 text-text-muted hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors">
                  <Plus className="h-3 w-3" />
                  Stage
                </span>
              </CreateChannelButton>
              <CreateChannelButton groupId={group.id} type="FORUM">
                <span className="bg-muted/40 text-text-muted hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors">
                  <Plus className="h-3 w-3" />
                  Forum
                </span>
              </CreateChannelButton>
              <button
                type="button"
                onClick={() => openSettings('categories')}
                className="bg-muted/40 text-text-muted hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors"
              >
                <Folder className="h-3 w-3" />
                Category
              </button>
            </div>
          )}

          {channels.length === 0 && (
            <p className="text-text-muted px-2 text-xs">Chưa có channel nào</p>
          )}
        </div>
      </ScrollArea>
      <UserFooter />
    </>
  );

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <aside className="border-divider bg-surface-secondary/50 hidden h-full w-[260px] shrink-0 flex-col border-r md:flex">
        {channelListBody}
      </aside>

      {navOpen && (
        <div
          role="presentation"
          onClick={() => setNavOpen(false)}
          className="bg-foreground/30 fixed inset-0 z-40 md:hidden"
        />
      )}
      <aside
        className={cn(
          'border-divider bg-surface-secondary shadow-elevated fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r transition-transform md:hidden',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Đóng channel list"
          className="hover:bg-muted absolute right-2 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md"
        >
          <X className="h-4 w-4" />
        </button>
        {channelListBody}
      </aside>

      <main className="bg-background relative flex h-full min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Mở danh sách kênh"
          title="Danh sách kênh"
          className={floatBtnClass('left-3 md:hidden')}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        {!inVoiceView && (
          <>
            <button
              type="button"
              onClick={() => setMemberOpen(true)}
              aria-label="Mở danh sách thành viên"
              className={floatBtnClass('right-3 lg:hidden')}
            >
              <Users className="h-4 w-4" />
            </button>
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
              <p className="mt-0.5 text-[11.5px] opacity-90">Lý do: {group.suspendReason}</p>
            )}
            <p className="mt-0.5 text-[11px] opacity-75">
              Bạn vẫn xem được lịch sử nhưng không gửi được tin nhắn mới. Liên hệ admin nếu cần
              khiếu nại.
            </p>
          </div>
        )}
        {children}
      </main>

      {!inVoiceView && (
        <>
          <div
            className={cn(
              'duration-base ease-soft-out hidden h-full shrink-0 overflow-hidden transition-[width] lg:block',
              memberCollapsed === true ? 'w-0' : 'w-[220px]',
            )}
            aria-hidden={memberCollapsed === true}
          >
            <MemberSidebar groupId={group.id} myRole={myRole} />
          </div>

          {memberOpen && (
            <div
              role="presentation"
              onClick={() => setMemberOpen(false)}
              className="bg-foreground/30 fixed inset-0 z-40 lg:hidden"
            />
          )}
          <div
            className={cn(
              'border-divider bg-surface-secondary shadow-elevated fixed inset-y-0 right-0 z-50 flex w-[260px] border-l transition-transform lg:hidden',
              memberOpen ? 'translate-x-0' : 'translate-x-full',
            )}
          >
            <button
              type="button"
              onClick={() => setMemberOpen(false)}
              aria-label="Đóng danh sách thành viên"
              className="hover:bg-muted absolute left-2 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md"
            >
              <X className="h-4 w-4" />
            </button>
            <MemberSidebar groupId={group.id} myRole={myRole} forceVisible />
          </div>
        </>
      )}

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
  const { data: user } = useMe();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const me = mounted ? user : null;
  if (!me) return null;
  return (
    <div className="border-divider bg-card/40 flex h-12 items-center gap-2.5 border-t px-3">
      <Avatar className="h-7 w-7">
        <AvatarImage src={me.image ?? undefined} />
        <AvatarFallback className="text-xs">{(me.name ?? 'U')[0]}</AvatarFallback>
      </Avatar>
      <span className="flex-1 truncate text-xs font-medium tracking-tight">{me.name ?? 'Bạn'}</span>
    </div>
  );
}
