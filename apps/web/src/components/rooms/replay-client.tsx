'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2, PlayCircle, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

import { useRealtimeEvent } from '@/lib/realtime-client';
import { useConfirm } from '@/lib/use-confirm';

export type ReplayChapter = {
  startSec: number;
  endSec: number;
  title: string;
  preview: string;
};

type RecordingData = {
  id: string;
  status: 'PROCESSING' | 'PROCESSED' | 'FAILED';
  fileUrl: string | null;
  duration: number | null;
  summary: string | null;
  transcript: string | null;
  chapters: ReplayChapter[] | null;
  startedAt: string;
  endedAt: string | null;
};

type Props = {
  roomId: string;
  roomName: string;
  recording: RecordingData;
  pusherChannelPrefix?: string;
  syncUrl?: string;
  deleteUrl?: string;
  afterDeleteHref?: string;
  canDelete?: boolean;
};

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ReplayClient({
  roomId,
  roomName,
  recording,
  pusherChannelPrefix = 'presence-room-',
  syncUrl,
  deleteUrl,
  afterDeleteHref,
  canDelete = false,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const triggerDelete = React.useCallback(async () => {
    if (!deleteUrl || deleting) return;
    const ok = await confirm({
      title: 'Xoá recording này?',
      description: 'Không khôi phục được.',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(deleteUrl, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `status ${res.status}`);
      if (afterDeleteHref) {
        router.push(afterDeleteHref);
      } else {
        router.back();
      }
    } catch (err) {
      console.error('[replay] delete fail:', err);
      toast.error('Xoá thất bại: ' + (err as Error).message);
      setDeleting(false);
    }
  }, [deleteUrl, deleting, afterDeleteHref, router, confirm]);

  const triggerSync = React.useCallback(
    async (force = false) => {
      if (!syncUrl || syncing) return;
      setSyncing(true);
      try {
        const u = force ? `${syncUrl}?force=1` : syncUrl;
        const res = await fetch(u, { method: 'POST' });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error ?? `status ${res.status}`);
        }
        router.refresh();
      } catch (err) {
        console.error('[replay] sync fail:', err);
      } finally {
        setSyncing(false);
      }
    },
    [syncUrl, syncing, router],
  );

  useRealtimeEvent<{ recordingId: string }>(
    `${pusherChannelPrefix}${roomId}`,
    'recording:processed',
    (data) => {
      if (data.recordingId === recording.id) router.refresh();
    },
    recording.status === 'PROCESSING',
  );

  React.useEffect(() => {
    if (recording.status !== 'PROCESSING') return;
    const id = setInterval(() => {
      if (syncUrl) {
        void triggerSync();
      } else {
        router.refresh();
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [recording.status, router, syncUrl, triggerSync]);

  const seekTo = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    void v.play();
  };

  return (
    <div className="bg-background grid h-full grid-rows-[auto_1fr] lg:grid-cols-[1fr_360px] lg:grid-rows-1">
      <main className="flex min-h-0 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/rooms/${roomId}`}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            >
              <ArrowLeft className="h-3 w-3" />
              {roomName}
            </Link>
            <span className="text-sm font-semibold">· Replay</span>
            <span className="text-muted-foreground text-xs">
              {new Date(recording.startedAt).toLocaleString('vi-VN')}
              {recording.duration ? ` · ${fmtTime(recording.duration)}` : null}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {syncUrl && recording.status === 'PROCESSING' && (
              <button
                onClick={() => triggerSync(false)}
                disabled={syncing}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
                title="Force-poll LiveKit để cập nhật status (dùng khi webhook không hoạt động)"
              >
                <Loader2 className={syncing ? 'h-3 w-3 animate-spin' : 'hidden h-3 w-3'} />
                {syncing ? 'Đang sync...' : 'Sync ngay'}
              </button>
            )}
            {syncUrl && recording.status === 'FAILED' && (
              <button
                onClick={() => triggerSync(true)}
                disabled={syncing}
                className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-300"
                title="Re-poll LiveKit + chạy lại pipeline (Whisper/summary)"
              >
                <Loader2 className={syncing ? 'h-3 w-3 animate-spin' : 'hidden h-3 w-3'} />
                {syncing ? 'Đang retry...' : 'Retry pipeline'}
              </button>
            )}
            {canDelete && deleteUrl && recording.status !== 'PROCESSING' && (
              <button
                onClick={triggerDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
                title="Xoá recording (R2 file + DB row)"
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                {deleting ? 'Đang xoá...' : 'Xoá'}
              </button>
            )}
            <StatusBadge status={recording.status} />
          </div>
        </header>

        <div className="aspect-video bg-black">
          {recording.fileUrl ? (
            <video
              ref={videoRef}
              src={recording.fileUrl}
              controls
              className="h-full w-full"
              preload="metadata"
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Video chưa sẵn sàng (đang chờ egress upload)
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-sm font-semibold">Tóm tắt</h3>
          {recording.summary ? (
            <div className="prose prose-sm dark:prose-invert mt-2 max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{recording.summary}</ReactMarkdown>
            </div>
          ) : recording.status === 'PROCESSING' ? (
            <p className="text-muted-foreground mt-2 text-xs">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              Đang AI tóm tắt buổi học. Sẽ tự refresh khi xong (~1-3 phút).
            </p>
          ) : recording.status === 'FAILED' ? (
            <p className="text-destructive mt-2 text-xs">
              <AlertCircle className="mr-1 inline h-3 w-3" />
              Pipeline lỗi — không có tóm tắt. Liên hệ mod để retry.
            </p>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">
              Không có transcript (Whisper chưa cấu hình hoặc audio rỗng).
            </p>
          )}
        </div>
      </main>

      <aside className="bg-muted/20 overflow-y-auto border-t lg:border-l lg:border-t-0">
        <section className="border-b p-4">
          <h3 className="mb-2 text-sm font-semibold">Chương ({recording.chapters?.length ?? 0})</h3>
          {recording.chapters && recording.chapters.length > 0 ? (
            <ul className="space-y-1.5">
              {recording.chapters.map((c, i) => (
                <li key={i}>
                  <button
                    onClick={() => seekTo(c.startSec)}
                    className="hover:bg-accent flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                  >
                    <PlayCircle className="text-primary mt-0.5 h-3 w-3 shrink-0" />
                    <span className="flex-1">
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {fmtTime(c.startSec)}
                      </span>
                      <span className="ml-2 font-medium">{c.title}</span>
                      <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-[11px]">
                        {c.preview}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">Chưa phát hiện chương nào.</p>
          )}
        </section>

        <section className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Transcript</h3>
          {recording.transcript ? (
            <p className="text-muted-foreground whitespace-pre-wrap text-xs leading-relaxed">
              {recording.transcript}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {recording.status === 'PROCESSING' ? 'Đang transcribe...' : 'Không có transcript.'}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

function StatusBadge({ status }: { status: RecordingData['status'] }) {
  if (status === 'PROCESSED') {
    return (
      <span className="bg-success/10 text-success rounded px-2 py-0.5 text-[10px] font-medium">
        ĐÃ XỬ LÝ
      </span>
    );
  }
  if (status === 'PROCESSING') {
    return (
      <span className="bg-warning/10 text-warning flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ĐANG XỬ LÝ
      </span>
    );
  }
  return (
    <span className="bg-destructive/10 text-destructive rounded px-2 py-0.5 text-[10px] font-medium">
      LỖI
    </span>
  );
}
