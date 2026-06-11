'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { RelativeTime } from '@/components/ui/relative-time';
import { cn } from '@/lib/utils';

export type DmThreadItem = {
  id: string;
  peer: {
    id: string;
    name: string | null;
    image: string | null;
  };
  lastMessageAt: string | null;
  lastMessage?: string | null;
  unreadCount?: number;
};

export function ThreadList() {
  const pathname = usePathname();
  const [query, setQuery] = React.useState('');
  const { data: threads = [], isLoading: loading } = useQuery({
    queryKey: qk.dmThreads(),
    queryFn: () => apiGet<{ threads: DmThreadItem[] }>('/api/dm').then((d) => d.threads ?? []),
  });

  const filtered = React.useMemo(() => {
    if (!query.trim()) return threads;
    const q = query.trim().toLowerCase();
    return threads.filter((t) => (t.peer.name ?? '').toLowerCase().includes(q));
  }, [threads, query]);

  return (
    <div className="bg-surface-secondary/50 flex h-full flex-col">
      <header className="border-divider flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight">Tin nhắn</h2>
        <button
          type="button"
          title="Tin nhắn mới (chọn member từ group)"
          className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      </header>

      <div className="border-divider border-b px-3 py-2.5">
        <div className="relative">
          <Search className="text-text-muted pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tin nhắn..."
            className="h-9 pl-9 text-sm"
          />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {loading ? (
          <ThreadListSkeleton />
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-muted-foreground text-sm">
              {query ? 'Không tìm thấy' : 'Chưa có tin nhắn'}
            </p>
            {!query && (
              <p className="text-text-muted mt-1 text-xs">
                Click avatar member trong group để bắt đầu DM.
              </p>
            )}
          </div>
        ) : (
          <ul className="p-2">
            {filtered.map((t) => {
              const href = `/messages/${t.id}`;
              const active = pathname === href;
              const unread = t.unreadCount ?? 0;
              const hasUnread = unread > 0 && !active;
              return (
                <li key={t.id}>
                  <Link
                    href={href}
                    className={cn(
                      'group/dm relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                      active ? 'bg-primary/10' : 'hover:bg-muted/60',
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="bg-primary absolute -left-1 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full"
                      />
                    )}
                    <Avatar className="h-11 w-11 shrink-0">
                      <AvatarImage src={t.peer.image ?? undefined} alt={t.peer.name ?? ''} />
                      <AvatarFallback className="text-sm">
                        {(t.peer.name ?? '?')[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={cn(
                            'truncate text-sm tracking-tight',
                            hasUnread || active ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {t.peer.name ?? 'Anonymous'}
                        </p>
                        {t.lastMessageAt && (
                          <span className="text-text-muted shrink-0 font-mono text-[11px] tabular-nums">
                            <RelativeTime date={t.lastMessageAt} />
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p
                          className={cn(
                            'truncate text-xs',
                            hasUnread ? 'text-foreground/85 font-medium' : 'text-muted-foreground',
                          )}
                        >
                          {t.lastMessage ?? (
                            <span className="text-text-muted italic">Chưa có tin nhắn</span>
                          )}
                        </p>
                        {hasUnread && (
                          <span className="bg-primary text-primary-foreground inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-bold">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThreadListSkeleton() {
  return (
    <ul className="space-y-2 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <div className="animate-soft-pulse bg-muted h-11 w-11 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="animate-soft-pulse bg-muted h-3.5 w-1/2 rounded" />
            <div className="animate-soft-pulse bg-muted/60 h-3 w-3/4 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}
