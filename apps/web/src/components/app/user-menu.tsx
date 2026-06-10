/**
 * User menu — Client Component, hiển thị avatar + dropdown ở topbar.
 *
 * Trách nhiệm:
 *  - Avatar với status dot góc dưới phải (online/idle/dnd/offline)
 *  - Status picker 4 mode + (V2) custom status text/emoji defer
 *  - Profile & settings link
 *  - Sign out
 *
 * Props từ AppTopbar (Server). Status fetch client-side trên mount.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Circle,
  CircleDot,
  Clock as ClockIcon,
  LogOut,
  MessageSquareText,
  Moon,
  User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { signOut } from '@/lib/auth-client';
import { purgeQueryCache } from '@/lib/query/idb-persister';
import { ACTIVE_USER_KEY } from '@/components/providers/cache-user-guard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { CustomStatusDialog } from './custom-status-dialog';

type Status = 'online' | 'idle' | 'dnd' | 'offline' | 'invisible';

const STATUS_META: Record<
  Status,
  { label: string; dot: string; icon: typeof Circle }
> = {
  online: { label: 'Đang hoạt động', dot: 'bg-success', icon: CircleDot },
  idle: { label: 'Vắng mặt', dot: 'bg-warning', icon: Moon },
  dnd: { label: 'Không làm phiền', dot: 'bg-destructive', icon: ClockIcon },
  invisible: { label: 'Ẩn (offline ảo)', dot: 'bg-slate-400', icon: Circle },
  offline: { label: 'Offline', dot: 'bg-slate-400', icon: Circle },
};

type Props = {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
};

function initials(name: string | null, email: string) {
  const source = name?.trim() || email.split('@')[0] || 'User';
  const parts = source.split(/\s+/).filter(Boolean);
  const personal = parts[parts.length - 1] ?? source;
  return personal[0]?.toUpperCase() ?? 'U';
}

export function UserMenu({ user }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const [updating, setUpdating] = React.useState(false);
  const [customOpen, setCustomOpen] = React.useState(false);
  // Mount-gate để tránh Radix DropdownMenu useId mismatch với React 19.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Status từ server qua React Query (key dùng chung với CustomStatusDialog).
  type UserStatusData = {
    status?: Status;
    statusText?: string | null;
    statusEmoji?: string | null;
  };
  const { data: statusData } = useQuery({
    queryKey: qk.userStatus(),
    queryFn: () => apiGet<UserStatusData>('/api/user/status'),
  });
  const status: Status = statusData?.status ?? 'online';

  const setStatusServer = async (next: Status) => {
    if (next === status || updating) return;
    setUpdating(true);
    const prev = qc.getQueryData<UserStatusData>(qk.userStatus());
    // Optimistic ghi vào cache.
    qc.setQueryData<UserStatusData>(qk.userStatus(), (old) => ({
      ...(old ?? {}),
      status: next,
    }));
    try {
      await apiSend('/api/user/status', 'PUT', { status: next, expiresInSec: null });
    } catch (err) {
      toast.error('Đổi trạng thái lỗi: ' + (err as Error).message);
      qc.setQueryData(qk.userStatus(), prev);
    } finally {
      setUpdating(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast.error(error.message ?? 'Could not sign out.');
      return;
    }
    // Dọn SẠCH cache React Query (in-memory + IndexedDB persist) — nếu không, tài
    // khoản đăng nhập kế tiếp trên cùng trình duyệt sẽ thấy data của user vừa thoát
    // (IndexedDB per-origin, không per-user). Reset luôn cờ active-user của guard.
    await purgeQueryCache(qc);
    localStorage.removeItem(ACTIVE_USER_KEY);
    router.push('/');
    router.refresh();
  };

  const meta = STATUS_META[status];

  if (!mounted) {
    return (
      <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0" disabled>
        <Avatar className="h-9 w-9">
          <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} />
          <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
        </Avatar>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
          <Avatar className="h-9 w-9">
            {user.image && <AvatarImage src={user.image} alt={user.name ?? user.email} />}
            <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
          </Avatar>
          {/* V2 G3: status dot góc dưới phải avatar — ring trắng để pop trên mọi bg. */}
          <span
            aria-label={meta.label}
            title={meta.label}
            className={cn(
              'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-background',
              meta.dot,
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{user.name ?? 'Account'}</span>
            <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* V2 G3: Status submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span
              className={cn('mr-2 inline-block h-2 w-2 shrink-0 rounded-full', meta.dot)}
              aria-hidden
            />
            <span className="flex-1 truncate">{meta.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {(['online', 'idle', 'dnd', 'invisible'] as Status[]).map((s) => {
              const m = STATUS_META[s];
              const active = s === status;
              return (
                <DropdownMenuItem
                  key={s}
                  onClick={() => setStatusServer(s)}
                  className="flex items-center gap-2"
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', m.dot)} aria-hidden />
                  <span className="flex-1">{m.label}</span>
                  {active && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* V2 G3.7: Custom status dialog trigger */}
        <DropdownMenuItem onClick={() => setCustomOpen(true)}>
          <MessageSquareText className="mr-2 h-4 w-4" />
          Đặt trạng thái tuỳ chỉnh
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/settings')}>
          <UserIcon className="mr-2 h-4 w-4" />
          Profile & settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>

      <CustomStatusDialog open={customOpen} onOpenChange={setCustomOpen} />
    </DropdownMenu>
  );
}
