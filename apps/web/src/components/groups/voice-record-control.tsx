/**
 * VoiceRecordControl — toggle record cho VOICE channel của study group.
 *
 * Tương tự rooms/record-button.tsx nhưng cho channel thay vì room:
 *   - POST/DELETE /api/channels/[id]/record
 *   - Subscribe `presence-voice-{channelId}` cho realtime sync giữa mod
 *   - Render nút "REC" + banner "Đang ghi" cho mọi participant
 *
 * Compliance: banner hiển thị cho TẤT CẢ participant (non-mod cũng thấy)
 * suốt thời gian recording — consent visibility theo GDPR.
 */
'use client';

import * as React from 'react';
import { Circle, Loader2, Square } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useRealtimeEvent } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type Props = {
  channelId: string;
  /** Chỉ MOD+ mới render — parent check role. */
  canRecord: boolean;
};

type RecState = 'IDLE' | 'STARTING' | 'RECORDING' | 'STOPPING';

type ApiListRecording = {
  id: string;
  status: 'RECORDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  startedAt: string;
};

export function VoiceRecordControl({ channelId, canRecord }: Props) {
  const [state, setState] = React.useState<RecState>('IDLE');
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Initial poll — biết có recording nào RECORDING không (e.g. mod khác đã start)
  React.useEffect(() => {
    if (!canRecord) return;
    fetch(`/api/channels/${channelId}/record`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { recordings: ApiListRecording[] }) => {
        const active = d.recordings.find((r) => r.status === 'RECORDING');
        if (active) {
          setActiveId(active.id);
          setState('RECORDING');
        }
      })
      .catch((err) => console.error('[voice-rec] init fail:', err));
  }, [channelId, canRecord]);

  // Realtime sync — nhiều mod cùng channel sẽ thấy state nhau (chỉ khi canRecord).
  const channel = `presence-voice-${channelId}`;
  useRealtimeEvent<{ recordingId: string }>(
    channel,
    'recording:started',
    (data) => {
      setActiveId(data.recordingId);
      setState('RECORDING');
    },
    canRecord,
  );
  useRealtimeEvent(
    channel,
    'recording:stopped',
    () => {
      setActiveId(null);
      setState('IDLE');
    },
    canRecord,
  );
  useRealtimeEvent(
    channel,
    'recording:ended',
    () => {
      setActiveId(null);
      setState('IDLE');
    },
    canRecord,
  );

  if (!canRecord) return null;

  const start = async () => {
    setState('STARTING');
    try {
      const res = await fetch(`/api/channels/${channelId}/record`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Start record fail');
      toast.success('Đã bắt đầu ghi voice channel');
      setActiveId(data.recordingId);
      setState('RECORDING');
    } catch (err) {
      setState('IDLE');
      toast.error((err as Error).message);
    }
  };

  const stop = async () => {
    if (!activeId) return;
    setState('STOPPING');
    try {
      const res = await fetch(
        `/api/channels/${channelId}/record/${activeId}/stop`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Stop record fail');
      toast.message('Đã dừng ghi. Đang xử lý transcript...');
      setActiveId(null);
      setState('IDLE');
    } catch (err) {
      setState('RECORDING');
      toast.error((err as Error).message);
    }
  };

  const isRecording = state === 'RECORDING' || state === 'STOPPING';
  const isLoading = state === 'STARTING' || state === 'STOPPING';

  return (
    <Button
      onClick={isRecording ? stop : start}
      disabled={isLoading}
      variant={isRecording ? 'destructive' : 'secondary'}
      size="sm"
      aria-label={isRecording ? 'Dừng ghi voice channel' : 'Bắt đầu ghi voice channel'}
      title={isRecording ? 'Dừng ghi (đang record)' : 'Bắt đầu ghi (mod+)'}
      className={cn('h-8 gap-1.5', isRecording && 'animate-pulse')}
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isRecording ? (
        <>
          <Square className="h-3 w-3 fill-current" />
          <span className="text-xs">REC</span>
        </>
      ) : (
        <>
          <Circle className="h-3.5 w-3.5 fill-red-500 text-red-500" />
          <span className="text-xs">Ghi</span>
        </>
      )}
    </Button>
  );
}

/**
 * VoiceRecordingBanner — banner đỏ "Đang ghi" hiển thị cho TẤT CẢ participant
 * khi mod đang record. Listen realtime event `recording:started`/`stopped`.
 *
 * Render fixed bottom của voice panel để mọi non-mod đều thấy (consent).
 */
export function VoiceRecordingBanner({ channelId }: { channelId: string }) {
  const [recording, setRecording] = React.useState(false);

  React.useEffect(() => {
    // Init: nếu vào lúc đang ghi sẵn thì banner hiện ngay
    fetch(`/api/channels/${channelId}/record`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { recordings: ApiListRecording[] }) => {
        const active = d.recordings.some((r) => r.status === 'RECORDING');
        setRecording(active);
      })
      .catch(() => {});
  }, [channelId]);

  const channel = `presence-voice-${channelId}`;
  useRealtimeEvent(channel, 'recording:started', () => setRecording(true));
  useRealtimeEvent(channel, 'recording:stopped', () => setRecording(false));
  useRealtimeEvent(channel, 'recording:ended', () => setRecording(false));

  if (!recording) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-700 dark:text-red-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <span className="font-medium">Đang ghi voice channel này — mọi audio/video sẽ được lưu lại</span>
    </div>
  );
}
