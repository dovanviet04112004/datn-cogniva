/**
 * RecordingBanner — privacy notice "Buổi học đang được ghi" hiển thị TO ở
 * top của room khi recording active.
 *
 * Compliance (Phase 15 §🔐):
 *   - Banner BẮT BUỘC hiển thị suốt thời gian REC (không cho dismiss).
 *   - Mọi participant đều thấy (cả mod tạo record).
 *   - Sub-text ghi rõ tên người start record để minh bạch.
 *
 * State sync: subscribe `recording:started` + `recording:stopped` + `recording:ended`
 * trên cùng channel `presence-room-{id}`.
 *
 * Initial load: query GET /api/rooms/{id}/record → check có recording active
 * (case mod refresh trang giữa session, banner phải show lại).
 */
'use client';

import * as React from 'react';
import { Circle } from 'lucide-react';

import { getPusherClient } from '@/lib/realtime-client';

type Props = {
  roomId: string;
};

type ApiRecording = {
  id: string;
  status: 'RECORDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
};

export function RecordingBanner({ roomId }: Props) {
  const [active, setActive] = React.useState<{ by: string } | null>(null);

  // Initial check
  React.useEffect(() => {
    fetch(`/api/rooms/${roomId}/record`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { recordings: ApiRecording[] } | null) => {
        if (!d) return;
        const a = d.recordings.find((r) => r.status === 'RECORDING');
        if (a) setActive({ by: 'mod' });
      })
      .catch(() => {});
  }, [roomId]);

  // Realtime sync
  React.useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher) return;

    const channel = pusher.subscribe(`presence-room-${roomId}`);
    const onStarted = (data: { byUserName?: string }) =>
      setActive({ by: data.byUserName ?? 'mod' });
    const onStopped = () => setActive(null);
    const onEnded = () => setActive(null);

    channel.bind('recording:started', onStarted);
    channel.bind('recording:stopped', onStopped);
    channel.bind('recording:ended', onEnded);
    return () => {
      channel.unbind('recording:started', onStarted);
      channel.unbind('recording:stopped', onStopped);
      channel.unbind('recording:ended', onEnded);
    };
  }, [roomId]);

  if (!active) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 border-b border-red-700/40 bg-red-600/95 px-4 py-1.5 text-xs font-medium text-white"
    >
      <Circle className="h-3 w-3 animate-pulse fill-white" />
      <span>
        Buổi học đang được GHI HÌNH bởi <strong>{active.by}</strong>. Video + transcript sẽ được lưu sau khi kết thúc.
      </span>
    </div>
  );
}
