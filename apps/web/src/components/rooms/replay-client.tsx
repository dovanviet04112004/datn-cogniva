/**
 * ReplayClient — UI client cho /rooms/[id]/recordings/[recId].
 *
 * Layout 2 cột:
 *   - Main : video player + summary card (top) + chapters list (bottom mobile).
 *   - Aside: chapters + transcript scrollable, click chapter → seek video.
 *
 * Polling khi status=PROCESSING:
 *   - Refetch /api/rooms/{id}/recordings/{recId} mỗi 10s cho tới khi
 *     PROCESSED hoặc FAILED → router.refresh() reload server data.
 *   - Subscribe realtime `recording:processed` để biết ngay khi worker BullMQ xong
 *     (instant feedback < 1s thay vì chờ polling tick).
 *
 * Note: video src dùng presigned URL hoặc public R2 URL. Phase 15 dev có thể
 * test với LiveKit egress local (file://) → cần serve qua /api/recordings/[id]/file
 * (V2 thêm route signed). Hiện trust fileUrl backend trả.
 */
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
  /**
   * Override realtime channel prefix khi component dùng cho voice channel của
   * study group (`presence-voice-`). Default `presence-room-` cho rooms.
   */
  pusherChannelPrefix?: string;
  /**
   * URL endpoint force-sync egress status từ LiveKit (workaround khi webhook
   * chưa cấu hình). Nếu set, hiện nút "Sync ngay" cạnh status badge khi đang
   * PROCESSING. Format: `/api/channels/{id}/record/{recId}/sync`.
   */
  syncUrl?: string;
  /**
   * URL endpoint xoá recording. Nếu set + canDelete=true → hiện nút "Xoá".
   * Format: `/api/channels/{id}/record/{recId}` (DELETE method).
   */
  deleteUrl?: string;
  /** Redirect tới URL này sau khi xoá thành công. */
  afterDeleteHref?: string;
  /** Cho phép xoá — caller check role mod+. */
  canDelete?: boolean;
};

/** Format giây → mm:ss (dùng cho chapter timestamp). */
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
  // Hook confirm styled — hoist ở đầu component
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

  // Realtime "processed" event → refresh ngay khi pipeline xong (chỉ khi đang PROCESSING).
  useRealtimeEvent<{ recordingId: string }>(
    `${pusherChannelPrefix}${roomId}`,
    'recording:processed',
    (data) => {
      if (data.recordingId === recording.id) router.refresh();
    },
    recording.status === 'PROCESSING',
  );

  // Fallback polling 15s nếu realtime miss event. Nếu có syncUrl (channel
  // recording — không có webhook tin cậy) thì gọi cả /sync để force-poll
  // egress status từ LiveKit, không chỉ refresh trang.
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
    <div className="grid h-full grid-rows-[auto_1fr] bg-background lg:grid-rows-1 lg:grid-cols-[1fr_360px]">
      {/* ── Main: video + summary ───────────────────── */}
      <main className="flex min-h-0 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/rooms/${roomId}`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              {roomName}
            </Link>
            <span className="text-sm font-semibold">· Replay</span>
            <span className="text-xs text-muted-foreground">
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
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {deleting ? 'Đang xoá...' : 'Xoá'}
              </button>
            )}
            <StatusBadge status={recording.status} />
          </div>
        </header>

        {/* Video */}
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
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Video chưa sẵn sàng (đang chờ egress upload)
            </div>
          )}
        </div>

        {/* Summary card */}
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-sm font-semibold">Tóm tắt</h3>
          {recording.summary ? (
            <div className="prose prose-sm mt-2 max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{recording.summary}</ReactMarkdown>
            </div>
          ) : recording.status === 'PROCESSING' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              Đang AI tóm tắt buổi học. Sẽ tự refresh khi xong (~1-3 phút).
            </p>
          ) : recording.status === 'FAILED' ? (
            <p className="mt-2 text-xs text-destructive">
              <AlertCircle className="mr-1 inline h-3 w-3" />
              Pipeline lỗi — không có tóm tắt. Liên hệ mod để retry.
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Không có transcript (Whisper chưa cấu hình hoặc audio rỗng).
            </p>
          )}
        </div>
      </main>

      {/* ── Sidebar: chapters + transcript ──────────── */}
      <aside className="border-t bg-muted/20 overflow-y-auto lg:border-l lg:border-t-0">
        <section className="border-b p-4">
          <h3 className="mb-2 text-sm font-semibold">Chương ({recording.chapters?.length ?? 0})</h3>
          {recording.chapters && recording.chapters.length > 0 ? (
            <ul className="space-y-1.5">
              {recording.chapters.map((c, i) => (
                <li key={i}>
                  <button
                    onClick={() => seekTo(c.startSec)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <PlayCircle className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    <span className="flex-1">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {fmtTime(c.startSec)}
                      </span>
                      <span className="ml-2 font-medium">{c.title}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground line-clamp-2">
                        {c.preview}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Chưa phát hiện chương nào.</p>
          )}
        </section>

        <section className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Transcript</h3>
          {recording.transcript ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {recording.transcript}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {recording.status === 'PROCESSING'
                ? 'Đang transcribe...'
                : 'Không có transcript.'}
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
      <span className="rounded bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
        ĐÃ XỬ LÝ
      </span>
    );
  }
  if (status === 'PROCESSING') {
    return (
      <span className="flex items-center gap-1 rounded bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ĐANG XỬ LÝ
      </span>
    );
  }
  return (
    <span className="rounded bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
      LỖI
    </span>
  );
}
