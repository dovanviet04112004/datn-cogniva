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
 *   - Subscribe Soketi `recording:processed` để biết ngay khi Inngest xong
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
import { AlertCircle, ArrowLeft, Loader2, PlayCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getPusherClient } from '@/lib/realtime-client';

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
};

/** Format giây → mm:ss (dùng cho chapter timestamp). */
function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ReplayClient({ roomId, roomName, recording }: Props) {
  const router = useRouter();
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // Subscribe realtime "processed" event để refresh ngay khi pipeline xong
  React.useEffect(() => {
    if (recording.status !== 'PROCESSING') return;
    const pusher = getPusherClient();
    if (!pusher) return;
    const channel = pusher.subscribe(`presence-room-${roomId}`);
    const handler = (data: { recordingId: string }) => {
      if (data.recordingId === recording.id) {
        router.refresh();
      }
    };
    channel.bind('recording:processed', handler);
    return () => {
      channel.unbind('recording:processed', handler);
    };
  }, [roomId, recording.id, recording.status, router]);

  // Fallback polling 15s nếu Soketi miss event
  React.useEffect(() => {
    if (recording.status !== 'PROCESSING') return;
    const id = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(id);
  }, [recording.status, router]);

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
          <StatusBadge status={recording.status} />
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
                      <span className="font-mono text-[10px] text-muted-foreground">
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
      <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/50 dark:text-green-300">
        ĐÃ XỬ LÝ
      </span>
    );
  }
  if (status === 'PROCESSING') {
    return (
      <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ĐANG XỬ LÝ
      </span>
    );
  }
  return (
    <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300">
      LỖI
    </span>
  );
}
