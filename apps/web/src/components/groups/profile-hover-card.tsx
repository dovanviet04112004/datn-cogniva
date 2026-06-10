/**
 * ProfileHoverCard — V2 G7.2 (2026-05-21).
 *
 * Wrapper hover popup hiển thị thông tin nhanh của 1 member khi user hover
 * vào avatar/name (Discord pattern). Trigger: 400ms delay để tránh spam khi
 * scroll qua.
 *
 * Layout popup:
 *   - Banner gradient theo role color
 *   - Avatar lớn + status dot
 *   - Display name + nickname
 *   - Role badge
 *   - Custom status (text + emoji) nếu có
 *   - Joined date
 *   - "Nhắn tin riêng" button (POST /api/dm)
 *
 * Spec: docs/plans/study-group-v2.md item 20 (User profile card).
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Crown, MessageSquare, Shield, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type GroupRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';

type MemberDetail = {
  userId: string;
  name: string | null;
  image: string | null;
  role: GroupRole;
  nickname: string | null;
  joinedAt: string;
  status?: 'online' | 'idle' | 'dnd' | 'offline' | 'invisible' | null;
  statusText?: string | null;
  statusEmoji?: string | null;
};

const ROLE_META: Record<
  GroupRole,
  { label: string; color: string; icon: typeof Crown | null }
> = {
  OWNER: { label: 'Owner', color: 'text-amber-500', icon: Crown },
  ADMIN: { label: 'Admin', color: 'text-purple-500', icon: ShieldCheck },
  MODERATOR: { label: 'Moderator', color: 'text-blue-500', icon: Shield },
  MEMBER: { label: 'Thành viên', color: 'text-muted-foreground', icon: null },
};

const STATUS_DOT: Record<NonNullable<MemberDetail['status']>, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-amber-500',
  dnd: 'bg-red-500',
  invisible: 'bg-slate-400',
  offline: 'bg-slate-400',
};

const STATUS_LABEL: Record<NonNullable<MemberDetail['status']>, string> = {
  online: 'Đang hoạt động',
  idle: 'Vắng mặt',
  dnd: 'Không làm phiền',
  invisible: 'Offline',
  offline: 'Offline',
};

type Props = {
  groupId: string;
  userId: string;
  children: React.ReactNode;
  /** Skip nếu user hover chính mình (Discord cũng skip). */
  isSelf?: boolean;
  /** Position popup: bên dưới (default) hoặc bên phải trigger. */
  side?: 'bottom' | 'right';
};

export function ProfileHoverCard({
  groupId,
  userId,
  children,
  isSelf = false,
  side = 'bottom',
}: Props) {
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Member detail qua React Query — cache 5 phút thay cho memberCache Map cũ,
  // fetch chỉ khi popup đã mở (sau delay 400ms) và không phải chính mình.
  const { data: detail, isLoading: loading } = useQuery({
    queryKey: qk.groupMemberDetail(groupId, userId),
    queryFn: () =>
      apiGet<MemberDetail>(`/api/groups/${groupId}/members/${userId}`),
    enabled: open && !isSelf,
    staleTime: 5 * 60_000,
  });

  const onEnter = () => {
    if (isSelf) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    // Mở sau 400ms hover → enabled bật → query fire (giữ hành vi delay cũ).
    openTimerRef.current = setTimeout(() => setOpen(true), 400);
  };

  const onLeave = () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    // Delay close để user kịp di chuột vào popup
    closeTimerRef.current = setTimeout(() => setOpen(false), 200);
  };

  return (
    <span
      ref={triggerRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      className="relative inline-block"
    >
      {children}
      {open && (
        <div
          onMouseEnter={() => {
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          }}
          onMouseLeave={onLeave}
          className={cn(
            'absolute z-50 w-64 rounded-xl border bg-popover shadow-elevated',
            side === 'bottom' ? 'left-0 top-[calc(100%+6px)]' : 'left-[calc(100%+6px)] top-0',
          )}
          role="dialog"
          aria-label="Profile preview"
        >
          {loading && !detail && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              Đang tải…
            </div>
          )}
          {detail && <ProfileBody detail={detail} />}
        </div>
      )}
    </span>
  );
}

function ProfileBody({ detail }: { detail: MemberDetail }) {
  const router = useRouter();
  const meta = ROLE_META[detail.role];
  const Icon = meta.icon;
  const display = detail.nickname ?? detail.name ?? 'Anonymous';
  const statusOk = detail.status && detail.status !== 'invisible';

  const openDm = async () => {
    try {
      const res = await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerUserId: detail.userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Mở DM thất bại');
      }
      const data = await res.json();
      if (data.thread?.id) router.push(`/messages/${data.thread.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <>
      {/* Banner — gradient theo role */}
      <div
        className={cn(
          'h-12 rounded-t-xl bg-gradient-to-br',
          detail.role === 'OWNER' && 'from-amber-500/40 to-orange-500/30',
          detail.role === 'ADMIN' && 'from-purple-500/40 to-pink-500/30',
          detail.role === 'MODERATOR' && 'from-blue-500/40 to-cyan-500/30',
          detail.role === 'MEMBER' && 'from-slate-500/30 to-slate-400/20',
        )}
      />
      <div className="px-3 pb-3">
        <div className="relative -mt-7">
          <Avatar className="h-14 w-14 ring-4 ring-popover">
            <AvatarImage src={detail.image ?? undefined} />
            <AvatarFallback className="text-base">
              {(display[0] ?? 'U').toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {detail.status && (
            <span
              aria-label={STATUS_LABEL[detail.status]}
              title={STATUS_LABEL[detail.status]}
              className={cn(
                'absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full ring-2 ring-popover',
                STATUS_DOT[detail.status],
              )}
            />
          )}
        </div>
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{display}</h3>
            {Icon && <Icon className={cn('h-3.5 w-3.5', meta.color)} />}
          </div>
          {detail.nickname && detail.name && (
            <p className="text-[11px] text-muted-foreground">@{detail.name}</p>
          )}
          <p className={cn('text-[11px] font-medium', meta.color)}>{meta.label}</p>
        </div>

        {statusOk && (detail.statusText || detail.statusEmoji) && (
          <div className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
            {detail.statusEmoji && (
              <span className="mr-1">{detail.statusEmoji}</span>
            )}
            {detail.statusText}
          </div>
        )}

        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <Calendar className="h-2.5 w-2.5" />
          Tham gia{' '}
          {new Date(detail.joinedAt).toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })}
        </div>

        <Button
          onClick={openDm}
          size="sm"
          variant="outline"
          className="mt-3 h-7 w-full gap-1.5 text-xs"
        >
          <MessageSquare className="h-3 w-3" />
          Nhắn tin riêng
        </Button>
      </div>
    </>
  );
}
