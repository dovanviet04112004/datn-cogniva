'use client';

import * as React from 'react';
import { Clock, History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type HistoryData = {
  current: {
    content: string;
    editedAt: string | null;
    createdAt: string;
  };
  revisions: {
    id: string;
    content: string;
    editedAt: string;
  }[];
};

type Props = {
  channelId: string;
  messageId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
};

export function MessageHistoryDialog({ channelId, messageId, open, onOpenChange }: Props) {
  const {
    data,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: qk.channelMessageHistory(channelId, messageId),
    queryFn: () => apiGet<HistoryData>(`/api/channels/${channelId}/messages/${messageId}/history`),
    enabled: open,
  });

  React.useEffect(() => {
    if (error) toast.error('Load lịch sử lỗi');
  }, [error]);

  const total = (data?.revisions.length ?? 0) + 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-[90vw] max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="text-primary h-4 w-4" />
            Lịch sử chỉnh sửa
            {data && (
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[10.5px] tabular-nums">
                {total} phiên bản
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Đang tải…
            </div>
          ) : !data ? (
            <p className="text-muted-foreground text-center text-sm">Không tải được lịch sử</p>
          ) : (
            <ol className="border-divider relative space-y-4 border-l pl-4">
              <RevisionEntry
                badge="Hiện tại"
                content={data.current.content}
                time={data.current.editedAt ?? data.current.createdAt}
                isCurrent
              />

              {data.revisions.length === 0 ? (
                <li className="text-muted-foreground text-[12px] italic">
                  Chưa có bản chỉnh sửa nào trước đó.
                </li>
              ) : (
                data.revisions.map((r) => (
                  <RevisionEntry key={r.id} badge={`Cũ`} content={r.content} time={r.editedAt} />
                ))
              )}

              {data.revisions.length > 0 && (
                <li className="text-muted-foreground pt-1 text-[10.5px]">
                  Tạo lúc{' '}
                  <span className="font-mono tabular-nums">
                    {new Date(data.current.createdAt).toLocaleString('vi-VN')}
                  </span>
                </li>
              )}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevisionEntry({
  badge,
  content,
  time,
  isCurrent,
}: {
  badge: string;
  content: string;
  time: string;
  isCurrent?: boolean;
}) {
  return (
    <li className="relative">
      <span
        className="ring-background absolute -left-[19px] top-1.5 h-2.5 w-2.5 rounded-full ring-2"
        style={{ backgroundColor: isCurrent ? 'hsl(var(--primary))' : '#9aa3af' }}
      />
      <div className="flex items-center gap-2 text-[10.5px]">
        <span
          className={
            isCurrent
              ? 'bg-primary/10 text-primary rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wider'
              : 'bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wider'
          }
        >
          {badge}
        </span>
        <Clock className="text-muted-foreground h-2.5 w-2.5" />
        <span className="text-muted-foreground font-mono tabular-nums">
          {new Date(time).toLocaleString('vi-VN')}
        </span>
      </div>
      <p className="bg-muted/30 mt-1 whitespace-pre-wrap break-words rounded-md border p-2.5 text-[13px] leading-relaxed">
        {content}
      </p>
    </li>
  );
}
