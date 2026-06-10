/**
 * RecordButton — toggle record buổi học (chỉ mod/owner thấy).
 *
 * State machine (sync với realtime events):
 *   - IDLE       : chưa có recording active → hiện Circle red
 *   - STARTING   : đang call POST /record → spinner
 *   - RECORDING  : có recording, blink red dot + "REC" label
 *   - STOPPING   : đang call /stop → spinner
 *
 * Khi recording active, các participant non-mod sẽ thấy banner "Buổi học đang
 * được ghi" qua realtime event `recording:started` (handled bởi RecordingBanner
 * trong room-client). Compliance: banner BẮT BUỘC hiển thị suốt thời gian REC.
 *
 * Polling: khi mount, GET /record → tìm recording status='RECORDING' → init
 * state. Sau đó dựa hoàn toàn vào realtime `recording:started` / `recording:stopped`
 * cho realtime sync giữa các mod (nhiều mod cùng phòng có thể thấy state nhau).
 */
'use client';

import * as React from 'react';
import { Circle, Loader2, Square } from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { useRealtimeEvent } from '@/lib/realtime-client';
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

  // Realtime sync giữa mod (chỉ khi visible) — recording:started/stopped/ended.
  const channel = `presence-room-${roomId}`;
  useRealtimeEvent<{ recordingId: string; byUserName?: string }>(
    channel,
    'recording:started',
    (data) => {
      setActiveId(data.recordingId);
      setState('RECORDING');
    },
    visible,
  );
  useRealtimeEvent<{ recordingId: string }>(
    channel,
    'recording:stopped',
    () => {
      setActiveId(null);
      setState('IDLE');
    },
    visible,
  );
  useRealtimeEvent<{ recordingId: string }>(
    channel,
    'recording:ended',
    () => {
      setActiveId(null);
      setState('IDLE');
    },
    visible,
  );

  if (!visible) return null;

  const start = async () => {
    setState('STARTING');
    try {
      const data = await apiSend<{ recordingId: string }>(
        `/api/rooms/${roomId}/record`,
        'POST',
      );
      toast.success('Đã bắt đầu ghi hình');
      // State sẽ flip thành RECORDING qua realtime event (kể cả mod khác)
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
      await apiSend(`/api/rooms/${roomId}/record/${activeId}/stop`, 'POST');
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
