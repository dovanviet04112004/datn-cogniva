/**
 * RecordButton — toggle record buổi học (chỉ mod/owner thấy).
 *
 * State machine (sync với Soketi events):
 *   - IDLE       : chưa có recording active → hiện Circle red
 *   - STARTING   : đang call POST /record → spinner
 *   - RECORDING  : có recording, blink red dot + "REC" label
 *   - STOPPING   : đang call /stop → spinner
 *
 * Khi recording active, các participant non-mod sẽ thấy banner "Buổi học đang
 * được ghi" qua Soketi event `recording:started` (handled bởi RecordingBanner
 * trong room-client). Compliance: banner BẮT BUỘC hiển thị suốt thời gian REC.
 *
 * Polling: khi mount, GET /record → tìm recording status='RECORDING' → init
 * state. Sau đó dựa hoàn toàn vào Soketi `recording:started` / `recording:stopped`
 * cho realtime sync giữa các mod (nhiều mod cùng phòng có thể thấy state nhau).
 */
'use client';

import * as React from 'react';
import { Circle, Loader2, Square } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { getPusherClient } from '@/lib/realtime-client';
import { cn } from '@/lib/utils';

type Props = {
  roomId: string;
  /** Chỉ render khi true — parent (ControlBar) check role. */
  visible: boolean;
};

type RecState = 'IDLE' | 'STARTING' | 'RECORDING' | 'STOPPING';

type ApiListRecording = {
  id: string;
  status: 'RECORDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  startedAt: string;
};

export function RecordButton({ roomId, visible }: Props) {
  const [state, setState] = React.useState<RecState>('IDLE');
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Initial: check có recording active không
  React.useEffect(() => {
    if (!visible) return;
    fetch(`/api/rooms/${roomId}/record`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { recordings: ApiListRecording[] }) => {
        const active = d.recordings.find((r) => r.status === 'RECORDING');
        if (active) {
          setActiveId(active.id);
          setState('RECORDING');
        }
      })
      .catch((err) => console.error('[record-btn] init fail:', err));
  }, [roomId, visible]);

  // Subscribe Soketi cho realtime sync giữa mod
  React.useEffect(() => {
    if (!visible) return;
    const pusher = getPusherClient();
    if (!pusher) return;

    const channel = pusher.subscribe(`presence-room-${roomId}`);

    const onStarted = (data: { recordingId: string; byUserName?: string }) => {
      setActiveId(data.recordingId);
      setState('RECORDING');
    };
    const onStopped = (_data: { recordingId: string }) => {
      setActiveId(null);
      setState('IDLE');
    };
    const onEnded = (_data: { recordingId: string }) => {
      setActiveId(null);
      setState('IDLE');
    };

    channel.bind('recording:started', onStarted);
    channel.bind('recording:stopped', onStopped);
    channel.bind('recording:ended', onEnded);

    return () => {
      channel.unbind('recording:started', onStarted);
      channel.unbind('recording:stopped', onStopped);
      channel.unbind('recording:ended', onEnded);
    };
  }, [roomId, visible]);

  if (!visible) return null;

  const start = async () => {
    setState('STARTING');
    try {
      const res = await fetch(`/api/rooms/${roomId}/record`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Start record fail');
      toast.success('Đã bắt đầu ghi hình');
      // State sẽ flip thành RECORDING qua Soketi event (kể cả mod khác)
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
      const res = await fetch(`/api/rooms/${roomId}/record/${activeId}/stop`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Stop record fail');
      toast.message('Đã dừng ghi hình. Đang xử lý transcript...');
      setActiveId(null);
      setState('IDLE');
    } catch (err) {
      setState('RECORDING'); // rollback
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
      size="icon"
      aria-label={isRecording ? 'Dừng ghi (REC đang chạy)' : 'Bắt đầu ghi buổi học'}
      title={isRecording ? 'Dừng ghi (đang record)' : 'Bắt đầu ghi (chỉ mod)'}
      className={cn(
        'relative',
        isRecording && 'animate-pulse',
      )}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isRecording ? (
        <Square className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Circle className="h-4 w-4 fill-red-500 text-red-500" />
      )}
    </Button>
  );
}
