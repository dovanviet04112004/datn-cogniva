'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Ban,
  Bell,
  BookOpen,
  CalendarCheck,
  Check,
  CheckCheck,
  Inbox,
  Loader2,
  MessageSquare,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatDock } from '@/components/dm/chat-dock';
import { useRealtimeEvent } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 60_000;

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

type NotifResponse = {
  notifications: Notification[];
  unreadCount: number;
};

export function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { openChat } = useChatDock();
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const { data, refetch } = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => apiGet<NotifResponse>('/api/notifications?limit=15'),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const notifs = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  const refresh = React.useCallback(() => {
    void refetch();
  }, [refetch]);
  useRealtimeEvent(`presence-user-${userId}`, 'notification:new', refresh);

  React.useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  const markAllRead = async () => {
    if (unread === 0) return;
    setLoading(true);
    const prev = qc.getQueryData<NotifResponse>(qk.notifications());
    qc.setQueryData<NotifResponse>(qk.notifications(), (old) =>
      old
        ? {
            notifications: old.notifications.map((n) =>
              n.readAt ? n : { ...n, readAt: new Date().toISOString() },
            ),
            unreadCount: 0,
          }
        : old,
    );
    try {
      await apiSend('/api/notifications/read', 'POST', { all: true });
    } catch {
      qc.setQueryData(qk.notifications(), prev);
      toast.error('Lỗi đánh dấu đã đọc');
    } finally {
      setLoading(false);
    }
  };

  const markOneAndNavigate = (n: Notification) => {
    if (!n.readAt) {
      const prev = qc.getQueryData<NotifResponse>(qk.notifications());
      qc.setQueryData<NotifResponse>(qk.notifications(), (old) =>
        old
          ? {
              notifications: old.notifications.map((x) =>
                x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
              ),
              unreadCount: Math.max(0, old.unreadCount - 1),
            }
          : old,
      );
      void apiSend('/api/notifications/read', 'POST', { ids: [n.id] }).catch(() => {
        qc.setQueryData(qk.notifications(), prev);
      });
    }

    if (n.type === 'dm-message') {
      const data = n.data ?? {};
      const threadId = typeof data.threadId === 'string' ? data.threadId : null;
      const author = (data.author ?? null) as {
        id: string;
        name: string | null;
        image: string | null;
      } | null;
      if (threadId && author) {
        setOpen(false);
        openChat({ threadId, peer: author });
        return;
      }
    }

    const href = deepLink(n);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  };

  if (!mounted) {
    return (
      <div className="text-muted-foreground relative inline-flex h-9 w-9 items-center justify-center rounded-md">
        <Bell className="h-4 w-4" />
      </div>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="text-muted-foreground hover:bg-muted hover:text-foreground relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors"
        aria-label={`Thông báo${unread > 0 ? ` (${unread} chưa đọc)` : ''}`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="bg-destructive text-destructive-foreground absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0" sideOffset={6}>
        <header className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[13px] font-semibold">Thông báo</span>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              disabled={loading}
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              Đánh dấu đã đọc
            </button>
          )}
        </header>

        <div className="max-h-[420px] overflow-y-auto">
          {notifs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Inbox className="text-muted-foreground/50 h-6 w-6" />
              <p className="text-muted-foreground text-xs">Chưa có thông báo</p>
            </div>
          ) : (
            <ul className="divide-y">
              {notifs.map((n) => (
                <NotifItem key={n.id} n={n} onClick={() => markOneAndNavigate(n)} />
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotifItem({ n, onClick }: { n: Notification; onClick: () => void }) {
  const unread = !n.readAt;
  const { Icon, iconCls } = iconFor(n.type);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'hover:bg-muted flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
          unread && 'bg-blue-500/5',
        )}
      >
        <div
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            iconCls,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-xs font-medium leading-tight">{n.title}</p>
            {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
          </div>
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px]">{n.body}</p>
          <p className="text-muted-foreground/70 mt-1 font-mono text-[11px]">
            {formatRel(new Date(n.createdAt))}
          </p>
        </div>
      </button>
    </li>
  );
}

function iconFor(type: string): { Icon: typeof Bell; iconCls: string } {
  if (type === 'admin-warn') {
    return {
      Icon: ShieldAlert,
      iconCls: 'bg-warning/15 text-warning',
    };
  }
  if (type === 'admin-group-suspend' || type === 'admin-group-delete') {
    return { Icon: Ban, iconCls: 'bg-destructive/15 text-destructive' };
  }
  if (type === 'admin-group-unsuspend') {
    return {
      Icon: Check,
      iconCls: 'bg-success/15 text-success',
    };
  }
  if (type === 'group-mention') {
    return {
      Icon: BookOpen,
      iconCls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    };
  }
  if (type === 'dm-message') {
    return {
      Icon: MessageSquare,
      iconCls: 'bg-discovery-500/15 text-discovery-600 dark:text-discovery-400',
    };
  }
  if (type.startsWith('booking-') || type === 'admin-booking-cancel') {
    return {
      Icon: CalendarCheck,
      iconCls: 'bg-primary/15 text-primary',
    };
  }
  return {
    Icon: AlertCircle,
    iconCls: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  };
}

function deepLink(n: Notification): string | null {
  const data = n.data ?? {};
  const groupId = typeof data.groupId === 'string' ? data.groupId : null;
  switch (n.type) {
    case 'admin-group-suspend':
    case 'admin-group-unsuspend':
      return groupId ? `/groups/${groupId}` : '/groups';
    case 'admin-group-delete':
      return '/groups';
    case 'group-join':
      return groupId ? `/groups/${groupId}` : '/groups';
    case 'booking-confirmed':
    case 'booking-completed':
    case 'booking-cancelled':
    case 'admin-booking-cancel': {
      const bookingId = typeof data.bookingId === 'string' ? data.bookingId : null;
      return bookingId ? `/tutoring?tab=orders&booking=${bookingId}` : '/tutoring?tab=orders';
    }
    case 'admin-warn':
      return '/profile';
    case 'group-mention': {
      const channelId = typeof data.channelId === 'string' ? data.channelId : null;
      return groupId && channelId
        ? `/groups/${groupId}?channel=${channelId}`
        : groupId
          ? `/groups/${groupId}`
          : null;
    }
    default:
      return null;
  }
}

function formatRel(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} ngày trước`;
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}
