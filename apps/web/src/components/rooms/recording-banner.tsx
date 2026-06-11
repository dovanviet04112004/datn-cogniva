'use client';

import * as React from 'react';
import { Circle } from 'lucide-react';

import { useRealtimeEvent } from '@/lib/realtime-client';

type Props = {
  roomId: string;
};

type ApiRecording = {
  id: string;
  status: 'RECORDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
};

export function RecordingBanner({ roomId }: Props) {
  const [active, setActive] = React.useState<{ by: string } | null>(null);

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

  const channel = `presence-room-${roomId}`;
  useRealtimeEvent<{ byUserName?: string }>(channel, 'recording:started', (data) =>
    setActive({ by: data.byUserName ?? 'mod' }),
  );
  useRealtimeEvent(channel, 'recording:stopped', () => setActive(null));
  useRealtimeEvent(channel, 'recording:ended', () => setActive(null));

  if (!active) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 border-b border-red-700/40 bg-red-600/95 px-4 py-1.5 text-xs font-medium text-white"
    >
      <Circle className="h-3 w-3 animate-pulse fill-white" />
      <span>
        Buổi học đang được GHI HÌNH bởi <strong>{active.by}</strong>. Video + transcript sẽ được lưu
        sau khi kết thúc.
      </span>
    </div>
  );
}
