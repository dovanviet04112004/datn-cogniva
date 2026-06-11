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
    <div className="bg-muted/30 shrink-0 border-t">
      <div className="text-muted-foreground px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider">
        Recordings ({items.length})
      </div>
      <ul className="max-h-48 overflow-auto p-2">
        {items.map((r) => (
          <li key={r.id} className="group/item hover:bg-accent flex items-center gap-2 rounded-md">
            <Link
              href={`/groups/recordings/${r.id}`}
              className="flex flex-1 items-center gap-3 px-2 py-2 text-sm"
            >
              <StatusIcon status={r.status} />
              <span className="flex-1 truncate">
                <span className="font-medium">{fmtDate(r.startedAt)}</span>
                {r.summary && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    — {r.summary.slice(0, 60)}…
                  </span>
                )}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {fmtDuration(r.duration)}
              </span>
              <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            </Link>
            {canDelete && r.status !== 'RECORDING' && (
              <button
                onClick={(e) => remove(r.id, e)}
                disabled={deletingId === r.id}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive mr-2 shrink-0 rounded p-1 opacity-0 disabled:opacity-50 group-hover/item:opacity-100"
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
      return <Loader2 className="text-muted-foreground h-3.5 w-3.5 shrink-0 animate-spin" />;
    case 'PROCESSED':
      return <Play className="h-3.5 w-3.5 shrink-0 text-green-600" />;
    case 'FAILED':
      return <XCircle className="text-destructive h-3.5 w-3.5 shrink-0" />;
  }
}
