/**
 * VoiceRecordingsList — list recordings của voice channel hiển thị dưới
 * pre-join screen (chưa connect voice). Click 1 item → /groups/recordings/[id].
 *
 * Status icon:
 *   - RECORDING  : dot đỏ blink
 *   - PROCESSING : spinner
 *   - PROCESSED  : Play icon
 *   - FAILED     : XCircle đỏ
 *
 * Auto-refresh khi nhận event `recording:processed` qua realtime (mod xem
 * realtime list update mà không cần reload).
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Circle, Loader2, Play, Trash2, XCircle, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

import { useRealtimeEvent } from '@/lib/realtime-client';
import { useConfirm } from '@/lib/use-confirm';

type Recording = {
  id: string;
  status: 'RECORDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  duration: number | null;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
};

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '?';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function VoiceRecordingsList({
  channelId,
  canDelete = false,
}: {
  channelId: string;
  /** Mod+ mới được xoá — parent check role. */
  canDelete?: boolean;
}) {
  const confirm = useConfirm();
  const [items, setItems] = React.useState<Recording[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const refetch = React.useCallback(() => {
    fetch(`/api/channels/${channelId}/record`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { recordings: Recording[] }) => setItems(d.recordings))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [channelId]);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  // Refresh khi recording state đổi (mọi event recording trên presence-voice → refetch).
  const channel = `presence-voice-${channelId}`;
  useRealtimeEvent(channel, 'recording:started', refetch);
  useRealtimeEvent(channel, 'recording:stopped', refetch);
  useRealtimeEvent(channel, 'recording:ended', refetch);
  useRealtimeEvent(channel, 'recording:processed', refetch);
  useRealtimeEvent(channel, 'recording:deleted', refetch);

  const remove = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: 'Xoá recording này?',
      description: 'File audio/video sẽ bị xoá khỏi storage. Không khôi phục được.',
      confirmLabel: 'Xoá recording',
      variant: 'destructive',
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/channels/${channelId}/record/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `status ${res.status}`);
      toast.success('Đã xoá recording');
      refetch();
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <div className="shrink-0 border-t bg-muted/30">
      <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Recordings ({items.length})
      </div>
      <ul className="max-h-48 overflow-auto p-2">
        {items.map((r) => (
          <li key={r.id} className="group/item flex items-center gap-2 rounded-md hover:bg-accent">
            <Link
              href={`/groups/recordings/${r.id}`}
              className="flex flex-1 items-center gap-3 px-2 py-2 text-sm"
            >
              <StatusIcon status={r.status} />
              <span className="flex-1 truncate">
                <span className="font-medium">{fmtDate(r.startedAt)}</span>
                {r.summary && (
                  <span className="ml-2 text-xs text-muted-foreground">— {r.summary.slice(0, 60)}…</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {fmtDuration(r.duration)}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
            {canDelete && r.status !== 'RECORDING' && (
              <button
                onClick={(e) => remove(r.id, e)}
                disabled={deletingId === r.id}
                className="mr-2 shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover/item:opacity-100 disabled:opacity-50"
                title="Xoá recording"
                aria-label="Xoá recording"
              >
                {deletingId === r.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: Recording['status'] }) {
  switch (status) {
    case 'RECORDING':
      return (
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <Circle className="h-3 w-3 fill-red-500 text-red-500" />
        </span>
      );
    case 'PROCESSING':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
    case 'PROCESSED':
      return <Play className="h-3.5 w-3.5 shrink-0 text-green-600" />;
    case 'FAILED':
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  }
}
