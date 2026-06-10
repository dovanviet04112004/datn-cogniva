/**
 * MessageHistoryDialog — V2 G2.7 (2026-05-21).
 *
 * Modal hiển thị timeline edit của 1 message. Click "(đã sửa)" badge trong
 * message-item mở dialog này.
 *
 * Layout:
 *   - Header: "Lịch sử chỉnh sửa"
 *   - Timeline: phiên bản hiện tại + revisions (mới → cũ), mỗi entry có
 *     content + thời gian + diff highlight (V2 chỉ show plain content, defer
 *     line-by-line diff sang V3).
 *   - Footer: close button
 */
'use client';

import * as React from 'react';
import { Clock, History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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

export function MessageHistoryDialog({
  channelId,
  messageId,
  open,
  onOpenChange,
}: Props) {
  // Lịch sử chỉnh sửa qua React Query — lazy fetch khi mở dialog.
  const { data, isLoading: loading, error } = useQuery({
    queryKey: qk.channelMessageHistory(channelId, messageId),
    queryFn: () =>
      apiGet<HistoryData>(
        `/api/channels/${channelId}/messages/${messageId}/history`,
      ),
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
            <History className="h-4 w-4 text-primary" />
            Lịch sử chỉnh sửa
            {data && (
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {total} phiên bản
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Đang tải…
            </div>
          ) : !data ? (
            <p className="text-center text-sm text-muted-foreground">
              Không tải được lịch sử
            </p>
          ) : (
            <ol className="relative space-y-4 border-l border-divider pl-4">
              {/* Current version */}
              <RevisionEntry
                badge="Hiện tại"
                content={data.current.content}
                time={data.current.editedAt ?? data.current.createdAt}
                isCurrent
              />

              {/* Older revisions (newest first) */}
              {data.revisions.length === 0 ? (
                <li className="text-[12px] italic text-muted-foreground">
                  Chưa có bản chỉnh sửa nào trước đó.
                </li>
              ) : (
                data.revisions.map((r) => (
                  <RevisionEntry
                    key={r.id}
                    badge={`Cũ`}
                    content={r.content}
                    time={r.editedAt}
                  />
                ))
              )}

              {/* Original */}
              {data.revisions.length > 0 && (
                <li className="pt-1 text-[10.5px] text-muted-foreground">
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
        className="absolute -left-[19px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background"
        style={{ backgroundColor: isCurrent ? 'hsl(var(--primary))' : '#9aa3af' }}
      />
      <div className="flex items-center gap-2 text-[10.5px]">
        <span
          className={
            isCurrent
              ? 'rounded-full bg-primary/10 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-primary'
              : 'rounded-full bg-muted px-1.5 py-0.5 font-semibold uppercase tracking-wider text-muted-foreground'
          }
        >
          {badge}
        </span>
        <Clock className="h-2.5 w-2.5 text-muted-foreground" />
        <span className="font-mono tabular-nums text-muted-foreground">
          {new Date(time).toLocaleString('vi-VN')}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-2.5 text-[13px] leading-relaxed">
        {content}
      </p>
    </li>
  );
}
