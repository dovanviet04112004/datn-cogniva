'use client';

import * as React from 'react';
import { AtSign, Bell, BellOff, Check, Pin, Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SearchDialog } from './search-dialog';

type PinnedMsg = {
  id: string;
  authorId: string;
  authorName: string | null;
  content: string;
  attachments: Array<{ type: string; url: string; name: string }> | null;
  createdAt: string;
};

export function ChannelHeaderActions({
  channelId,
  groupId,
}: {
  channelId: string;
  groupId: string;
}) {
  const [searchOpen, setSearchOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <span className="ml-auto flex items-center gap-0.5">
      <NotificationSettingMenu channelId={channelId} />
      <PinPopover channelId={channelId} />
      <button
        onClick={() => setSearchOpen(true)}
        className="hover:bg-accent rounded p-1.5"
        title="Tìm tin nhắn (Ctrl+K)"
        aria-label="Search"
      >
        <Search className="text-muted-foreground h-4 w-4" />
      </button>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} groupId={groupId} />
    </span>
  );
}

type NotifSetting = 'all' | 'mentions' | 'none';

const NOTIF_META: Record<NotifSetting, { label: string; desc: string; icon: typeof Bell }> = {
  all: {
    label: 'Tất cả tin nhắn',
    desc: 'Push cho mọi tin nhắn mới',
    icon: Bell,
  },
  mentions: {
    label: 'Chỉ khi @mention',
    desc: 'Chỉ thông báo khi bạn được nhắc tên',
    icon: AtSign,
  },
  none: {
    label: 'Tắt thông báo',
    desc: 'Không push (vẫn có trong inbox)',
    icon: BellOff,
  },
};

function NotificationSettingMenu({ channelId }: { channelId: string }) {
  const qc = useQueryClient();

  const { data, isLoading: loading } = useQuery({
    queryKey: qk.channelNotificationSetting(channelId),
    queryFn: () =>
      apiGet<{ setting?: NotifSetting }>(`/api/channels/${channelId}/notification-setting`).then(
        (d) => d.setting ?? 'all',
      ),
  });
  const setting: NotifSetting = data ?? 'all';

  const setServer = async (next: NotifSetting) => {
    if (next === setting) return;
    const key = qk.channelNotificationSetting(channelId);
    const prev = qc.getQueryData<NotifSetting>(key);
    qc.setQueryData<NotifSetting>(key, next);
    try {
      await apiSend(`/api/channels/${channelId}/notification-setting`, 'PUT', {
        setting: next,
      });
      toast.success(`Đã đặt: ${NOTIF_META[next].label}`);
    } catch (err) {
      toast.error('Đổi setting lỗi: ' + (err as Error).message);
      qc.setQueryData(key, prev);
    }
  };

  const ActiveIcon = NOTIF_META[setting].icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={loading}
          className={cn(
            'hover:bg-accent rounded p-1.5 transition-colors disabled:opacity-50',
            setting !== 'all' && 'text-primary',
          )}
          title={NOTIF_META[setting].label}
          aria-label="Cài đặt thông báo channel"
        >
          <ActiveIcon className="text-muted-foreground h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-[10.5px] font-semibold uppercase tracking-wider">
          Thông báo channel
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(['all', 'mentions', 'none'] as NotifSetting[]).map((s) => {
          const m = NOTIF_META[s];
          const Icon = m.icon;
          const active = s === setting;
          return (
            <DropdownMenuItem
              key={s}
              onClick={() => setServer(s)}
              className="flex items-start gap-2"
            >
              <Icon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium leading-tight">{m.label}</p>
                <p className="text-muted-foreground mt-0.5 text-[10.5px]">{m.desc}</p>
              </div>
              {active && <Check className="text-primary mt-1 h-3.5 w-3.5 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PinPopover({ channelId }: { channelId: string }) {
  const [open, setOpen] = React.useState(false);

  const {
    data: items = [],
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: qk.channelPinned(channelId),
    queryFn: () =>
      apiGet<{ pinned: PinnedMsg[] }>(`/api/channels/${channelId}/pinned`).then(
        (d) => d.pinned ?? [],
      ),
    enabled: open,
  });

  React.useEffect(() => {
    if (error) toast.error('Không tải được pinned');
  }, [error]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="hover:bg-accent rounded p-1.5"
          title="Pinned messages"
          aria-label="Pinned"
        >
          <Pin className="text-muted-foreground h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="text-muted-foreground border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider">
          Pinned messages
        </div>
        <div className="max-h-[400px] overflow-auto">
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              Đang tải...
            </div>
          ) : items.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-xs">
              Chưa có tin nào được pin.
              <br />
              Pin tin nhắn quan trọng để member dễ tìm.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((m) => (
                <li key={m.id} className="px-3 py-2">
                  <div className="text-muted-foreground text-[10px]">
                    <span className="font-medium">{m.authorName ?? 'Anonymous'}</span> ·{' '}
                    {new Date(m.createdAt).toLocaleDateString('vi-VN')}
                  </div>
                  <p className="mt-0.5 line-clamp-3 text-xs">{m.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
