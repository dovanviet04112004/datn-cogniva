'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Copy,
  Crown,
  MessageSquare,
  MoreVertical,
  Shield,
  ShieldCheck,
  UserRound,
  VolumeX,
  Volume2,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useChatDock } from '@/components/dm/chat-dock';
import { useConfirm } from '@/lib/use-confirm';
import { cn } from '@/lib/utils';
import type { GroupRole } from '@/lib/group/permissions';

import { usePresence } from './presence-context';

const ROLE_RANK: Record<GroupRole, number> = { OWNER: 0, ADMIN: 1, MODERATOR: 2, MEMBER: 3 };

type Member = {
  userId: string;
  name: string | null;
  image: string | null;
  role: GroupRole;
  nickname: string | null;
  mutedUntil: string | null;
  lastSeenAt: string | null;
  joinedAt: string;
  status?: 'online' | 'idle' | 'dnd' | 'offline' | 'invisible';
  statusText?: string | null;
  statusEmoji?: string | null;
};

const STATUS_DOT_CLASS: Record<NonNullable<Member['status']>, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-amber-500',
  dnd: 'bg-red-500',
  invisible: 'bg-slate-400',
  offline: 'bg-slate-400',
};

const STATUS_LABEL: Record<NonNullable<Member['status']>, string> = {
  online: 'Đang hoạt động',
  idle: 'Vắng mặt',
  dnd: 'Không làm phiền',
  invisible: 'Offline',
  offline: 'Offline',
};

const ROLE_ICON = {
  OWNER: Crown,
  ADMIN: ShieldCheck,
  MODERATOR: Shield,
  MEMBER: null,
} as const;

const ROLE_COLOR = {
  OWNER: 'text-warning',
  ADMIN: 'text-purple-500',
  MODERATOR: 'text-blue-500',
  MEMBER: 'text-muted-foreground',
} as const;

function isOnline(member: Member, onlineSet: Set<string>): boolean {
  return onlineSet.has(member.userId);
}

export function MemberSidebar({
  groupId,
  myRole,
  forceVisible = false,
}: {
  groupId: string;
  myRole?: GroupRole;
  forceVisible?: boolean;
}) {
  const qc = useQueryClient();
  const { online, statusMap, setInitialStatus } = usePresence();

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.groupMembers(groupId),
    queryFn: () =>
      apiGet<{ members: Member[] }>(`/api/groups/${groupId}/members`).then((d) => d.members ?? []),
  });
  const members = data ?? [];

  React.useEffect(() => {
    if (!data) return;
    setInitialStatus(
      data
        .filter((m) => m.status)
        .map((m) => ({
          userId: m.userId,
          status: m.status!,
          statusText: m.statusText,
          statusEmoji: m.statusEmoji,
        })),
    );
  }, [data, setInitialStatus]);

  const reloadMembers = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.groupMembers(groupId) });
  }, [qc, groupId]);

  const sorted = React.useMemo(() => {
    const rank: Record<GroupRole, number> = { OWNER: 0, ADMIN: 1, MODERATOR: 2, MEMBER: 3 };
    return [...members].sort((a, b) => {
      const r = rank[a.role] - rank[b.role];
      if (r !== 0) return r;
      const o = Number(isOnline(b, online)) - Number(isOnline(a, online));
      if (o !== 0) return o;
      return (a.nickname ?? a.name ?? '').localeCompare(b.nickname ?? b.name ?? '');
    });
  }, [members, online]);

  const onlineCount = sorted.filter((m) => isOnline(m, online)).length;
  const groupByRole = {
    OWNER: sorted.filter((m) => m.role === 'OWNER'),
    ADMIN: sorted.filter((m) => m.role === 'ADMIN'),
    MODERATOR: sorted.filter((m) => m.role === 'MODERATOR'),
    MEMBER: sorted.filter((m) => m.role === 'MEMBER'),
  };

  return (
    <aside
      className={cn(
        'bg-muted/20 h-full w-[220px] shrink-0 flex-col overflow-hidden border-l',
        forceVisible ? 'flex w-full' : 'flex',
      )}
    >
      <div className={cn('flex h-12 shrink-0 items-center border-b px-3', forceVisible && 'pl-12')}>
        <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
          Thành viên — {members.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 px-2 py-3">
          {loading ? (
            <MemberSkeleton />
          ) : (
            <>
              {(['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'] as const).map((role) => {
                const list = groupByRole[role];
                if (list.length === 0) return null;
                return (
                  <div key={role} className="space-y-0.5">
                    <p className="text-muted-foreground px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider">
                      {role === 'OWNER' && 'Owner'}
                      {role === 'ADMIN' && 'Admin'}
                      {role === 'MODERATOR' && 'Moderator'}
                      {role === 'MEMBER' && `Thành viên — ${list.length}`}
                    </p>
                    {list.map((m) => (
                      <MemberRow
                        key={m.userId}
                        member={m}
                        groupId={groupId}
                        myRole={myRole}
                        online={online.has(m.userId)}
                        statusInfo={statusMap.get(m.userId) ?? null}
                        onChanged={reloadMembers}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>
      <div className="text-muted-foreground border-t px-3 py-1.5 text-[10px]">
        <span className="text-foreground font-medium">{onlineCount}</span> online
      </div>
    </aside>
  );
}

function MemberSkeleton() {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Skeleton className="ml-2 h-3 w-16" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <Skeleton className="ml-2 h-3 w-20" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  groupId,
  myRole,
  online,
  statusInfo,
  onChanged,
}: {
  member: Member;
  groupId: string;
  myRole?: GroupRole;
  online: boolean;
  statusInfo: {
    status: NonNullable<Member['status']>;
    statusText?: string | null;
    statusEmoji?: string | null;
  } | null;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { currentUserId, openChat } = useChatDock();
  const confirm = useConfirm();
  const Icon = ROLE_ICON[member.role];
  const display = member.nickname ?? member.name ?? 'Anonymous';

  const rawStatus = statusInfo?.status ?? member.status ?? 'online';
  const effectiveStatus: NonNullable<Member['status']> = !online
    ? 'offline'
    : rawStatus === 'invisible'
      ? 'offline'
      : rawStatus;
  const customStatusText = statusInfo?.statusText ?? member.statusText;
  const customStatusEmoji = statusInfo?.statusEmoji ?? member.statusEmoji;

  const isSelf = member.userId === currentUserId;
  const canModerate = !!myRole && !isSelf && ROLE_RANK[myRole] < ROLE_RANK[member.role];
  const isMuted = !!member.mutedUntil && new Date(member.mutedUntil).getTime() > Date.now();

  const openDmDock = async () => {
    try {
      const res = await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerUserId: member.userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Mở chat thất bại');
      }
      const data = await res.json();
      if (data.thread?.id) {
        openChat({
          threadId: data.thread.id,
          peer: { id: member.userId, name: member.name, image: member.image },
        });
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const copyName = async () => {
    try {
      await navigator.clipboard?.writeText(display);
      toast.success('Đã sao chép tên');
    } catch {}
  };

  const toggleMute = async () => {
    try {
      const res = await fetch(
        `/api/groups/${groupId}/members/${member.userId}/mute`,
        isMuted
          ? { method: 'DELETE' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ durationSec: 600 }),
            },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Thao tác thất bại');
      }
      toast.success(isMuted ? `Đã bỏ tắt tiếng ${display}` : `Đã tắt tiếng ${display} (10 phút)`);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const kick = async () => {
    const ok = await confirm({
      title: `Kick ${display}?`,
      description: 'Thành viên sẽ bị xoá khỏi nhóm (có thể tham gia lại bằng lời mời).',
      variant: 'destructive',
      confirmLabel: 'Kick',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/groups/${groupId}/members/${member.userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Kick thất bại');
      }
      toast.success(`Đã kick ${display}`);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="hover:bg-accent/50 group flex items-center gap-2 rounded-md px-2 py-1">
      <button
        type="button"
        onClick={openDmDock}
        title="Nhắn tin riêng"
        className="relative shrink-0"
      >
        <Avatar className="h-7 w-7">
          <AvatarImage src={member.image ?? undefined} />
          <AvatarFallback className="text-[10px]">{display[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <span
          aria-label={STATUS_LABEL[effectiveStatus]}
          title={STATUS_LABEL[effectiveStatus]}
          className={cn(
            'border-background absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2',
            STATUS_DOT_CLASS[effectiveStatus],
          )}
        />
      </button>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm">{display}</span>
        {(customStatusText || customStatusEmoji) && effectiveStatus !== 'offline' && (
          <span className="text-muted-foreground block truncate text-[10.5px]">
            {customStatusEmoji && <span className="mr-1">{customStatusEmoji}</span>}
            {customStatusText}
          </span>
        )}
      </div>
      {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', ROLE_COLOR[member.role])} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Tùy chọn thành viên"
            title="Tùy chọn"
            className="text-muted-foreground hover:bg-accent hover:text-foreground hidden shrink-0 rounded p-1 transition-colors group-hover:block data-[state=open]:block"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onClick={() => router.push(`/profile/${member.userId}`)}
            className="gap-2"
          >
            <UserRound className="text-muted-foreground h-4 w-4" /> Xem hồ sơ
          </DropdownMenuItem>
          {!isSelf && (
            <DropdownMenuItem onClick={openDmDock} className="gap-2">
              <MessageSquare className="text-muted-foreground h-4 w-4" /> Nhắn tin
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={copyName} className="gap-2">
            <Copy className="text-muted-foreground h-4 w-4" /> Sao chép tên
          </DropdownMenuItem>
          {canModerate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleMute} className="gap-2">
                {isMuted ? (
                  <Volume2 className="text-muted-foreground h-4 w-4" />
                ) : (
                  <VolumeX className="text-muted-foreground h-4 w-4" />
                )}
                {isMuted ? 'Bỏ tắt tiếng' : 'Tắt tiếng (10 phút)'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={kick}
                className="gap-2 text-red-600 focus:bg-red-500/10 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
              >
                <UserX className="h-4 w-4" /> Kick khỏi nhóm
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
