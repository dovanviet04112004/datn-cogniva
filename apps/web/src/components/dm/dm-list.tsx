/**
 * DmList — list DM thread của user.
 *
 * Render compact divide-y rows. Click thread → /messages/[id].
 */
'use client';

import Link from 'next/link';
import { MessageSquare, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';

type Thread = {
  id: string;
  peer: { id: string; name: string | null; image: string | null };
  lastMessageAt: string;
};

export function DmList({ currentUserId }: { currentUserId: string }) {
  void currentUserId;
  // React Query: share cache với ThreadList (cùng qk.dmThreads).
  const { data: threads = [], isLoading: loading } = useQuery({
    queryKey: qk.dmThreads(),
    queryFn: () => apiGet<{ threads: Thread[] }>('/api/dm').then((d) => d.threads ?? []),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <MessageSquare className="h-5 w-5 sm:h-6 sm:w-6" />
          Tin nhắn
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
          Chat riêng 1-1. Để bắt đầu, click vào avatar 1 member trong group.
        </p>
      </div>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải...
        </Card>
      ) : threads.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Chưa có tin nhắn nào.
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {threads.map((t) => (
            <Link
              key={t.id}
              href={`/messages/${t.id}`}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50"
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={t.peer.image ?? undefined} />
                <AvatarFallback>{(t.peer.name ?? 'U')[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.peer.name ?? 'Unknown'}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(t.lastMessageAt).toLocaleString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </p>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
