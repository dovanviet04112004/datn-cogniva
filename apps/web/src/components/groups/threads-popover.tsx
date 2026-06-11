'use client';

import * as React from 'react';
import { Archive, Hash, Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

type Thread = {
  id: string;
  title: string | null;
  content: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  threadCount: number;
  threadLastAt: string | null;
  createdAt: string;
  archivedAt?: string | null;
};

type Tab = 'active' | 'archived';

type Props = {
  channelId: string;
  onOpenThread: (threadRootId: string) => void;
};

export function ThreadsPopover({ channelId, onOpenThread }: Props) {
  const [open, setOpen] = React.useState(false);
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('active');

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    const url =
      tab === 'archived'
        ? `/api/channels/${channelId}/threads?includeArchived=1`
        : `/api/channels/${channelId}/threads`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: { threads: Thread[] }) => {
        const list = d.threads ?? [];
        setThreads(
          tab === 'archived'
            ? list.filter((t) => !!t.archivedAt)
            : list.filter((t) => !t.archivedAt),
        );
      })
      .catch(() => toast.error('Không tải được thread list'))
      .finally(() => setLoading(false));
  }, [open, channelId, tab]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="hover:bg-accent rounded p-1.5"
          title="Threads (Discord-style)"
          aria-label="Threads"
        >
          <Hash className="text-muted-foreground h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          <TabBtn
            label="Đang hoạt động"
            active={tab === 'active'}
            onClick={() => setTab('active')}
          />
          <TabBtn
            label="Đã lưu trữ"
            icon={Archive}
            active={tab === 'archived'}
            onClick={() => setTab('archived')}
          />
        </div>
        <ScrollArea className="max-h-[420px]">
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              Đang tải…
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 p-8 text-center">
              {tab === 'archived' ? (
                <>
                  <Archive className="text-muted-foreground/40 h-7 w-7" />
                  <p className="text-xs font-medium">Chưa có thread lưu trữ</p>
                  <p className="text-muted-foreground text-[10.5px]">
                    Thread idle &gt; 7 ngày sẽ tự lưu trữ. Reply sẽ kích hoạt lại.
                  </p>
                </>
              ) : (
                <>
                  <MessageSquare className="text-muted-foreground/40 h-7 w-7" />
                  <p className="text-xs font-medium">Chưa có thread nào</p>
                  <p className="text-muted-foreground text-[10.5px]">
                    Mở thread từ menu của 1 message trong channel.
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      onOpenThread(t.id);
                    }}
                    className="hover:bg-accent/50 block w-full px-3 py-2.5 text-left"
                  >
                    <div className="flex items-start gap-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={t.authorImage ?? undefined} />
                        <AvatarFallback className="text-[10px]">
                          {(t.authorName ?? 'U')[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        {t.title && <p className="truncate text-xs font-semibold">{t.title}</p>}
                        <p className="text-muted-foreground line-clamp-2 text-[11.5px]">
                          {t.content || '(không có nội dung)'}
                        </p>
                        <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[10px]">
                          <span className="font-medium">{t.authorName ?? 'Anonymous'}</span>
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="h-2.5 w-2.5" />
                            {t.threadCount}
                          </span>
                          {t.threadLastAt && <span>{fmtRelative(t.threadLastAt)}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function TabBtn({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon?: typeof Archive;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

function fmtRelative(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return 'vừa xong';
  if (sec < 3600) return `${Math.floor(sec / 60)} phút`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} giờ`;
  if (sec < 604_800) return `${Math.floor(sec / 86_400)} ngày`;
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  });
}
