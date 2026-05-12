/**
 * PomodoroTimer — đếm ngược 25/5/15 phút đồng bộ giữa các participant.
 *
 * Sync qua LiveKit data channel (lightweight, không cần Soketi). Mod
 * start/pause/reset/setMode → broadcast PomoState → mọi participant render
 * countdown dựa trên state. Vì client tự tính từ startAt + durationSec,
 * không cần sync mỗi giây → ổn dù latency.
 *
 * Mode:
 *   - FOCUS (25 phút): mặc định
 *   - SHORT_BREAK (5 phút)
 *   - LONG_BREAK (15 phút)
 *
 * Drift handling: dùng wallclock (Date.now()) thay vì interval count → khỏi
 * lệch khi tab background throttle.
 */
'use client';

import * as React from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { Coffee, Pause, Play, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Mode = 'FOCUS' | 'SHORT_BREAK' | 'LONG_BREAK';

type PomoState = {
  mode: Mode;
  /** Wallclock ms khi mod start. null = chưa chạy. */
  startAt: number | null;
  durationSec: number;
  /** Wallclock ms khi pause. null = đang chạy. */
  pausedAt: number | null;
};

const MODE_SEC: Record<Mode, number> = {
  FOCUS: 25 * 60,
  SHORT_BREAK: 5 * 60,
  LONG_BREAK: 15 * 60,
};

const MODE_LABEL: Record<Mode, string> = {
  FOCUS: 'Tập trung',
  SHORT_BREAK: 'Giải lao ngắn',
  LONG_BREAK: 'Giải lao dài',
};

const INITIAL: PomoState = {
  mode: 'FOCUS',
  startAt: null,
  durationSec: MODE_SEC.FOCUS,
  pausedAt: null,
};

type Props = {
  /** Quyền điều khiển (OWNER/MODERATOR). Member chỉ xem. */
  canControl: boolean;
};

export function PomodoroTimer({ canControl }: Props) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [state, setState] = React.useState<PomoState>(INITIAL);
  const [now, setNow] = React.useState(Date.now());

  // Nhận state từ mod qua data channel
  React.useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === 'POMO_STATE') setState(data.state);
      } catch {
        /* ignore malformed */
      }
    };
    room.on('dataReceived', handler);
    return () => { room.off('dataReceived', handler); };
  }, [room]);

  // Tick mỗi giây — chỉ rerender, time tính từ wallclock
  React.useEffect(() => {
    if (!state.startAt || state.pausedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.startAt, state.pausedAt]);

  // Tính remaining (giây) dựa trên wallclock
  const elapsedMs = state.startAt
    ? (state.pausedAt ?? now) - state.startAt
    : 0;
  const remainingSec = Math.max(0, state.durationSec - Math.floor(elapsedMs / 1000));
  const mm = Math.floor(remainingSec / 60);
  const ss = remainingSec % 60;

  /** Broadcast state mới qua data channel. */
  const broadcast = (next: PomoState) => {
    setState(next);
    localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: 'POMO_STATE', state: next })),
      { reliable: true },
    );
  };

  const start = () => {
    if (state.pausedAt) {
      // Resume — shift startAt thêm khoảng pause duration
      const pauseDur = Date.now() - state.pausedAt;
      broadcast({ ...state, startAt: state.startAt! + pauseDur, pausedAt: null });
    } else {
      broadcast({ ...state, startAt: Date.now(), pausedAt: null });
    }
  };

  const pause = () => broadcast({ ...state, pausedAt: Date.now() });
  const reset = () => broadcast({ mode: state.mode, startAt: null, durationSec: MODE_SEC[state.mode], pausedAt: null });

  const setMode = (mode: Mode) => {
    broadcast({ mode, startAt: null, durationSec: MODE_SEC[mode], pausedAt: null });
  };

  const isRunning = state.startAt !== null && state.pausedAt === null;
  const isInBreak = state.mode !== 'FOCUS';

  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border px-3 py-1.5',
      isInBreak ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-card',
    )}>
      {isInBreak && <Coffee className="h-3.5 w-3.5 text-emerald-600" />}
      <span className="font-mono text-base tabular-nums">
        {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
      </span>
      <span className="hidden text-[10px] text-muted-foreground sm:inline">
        {MODE_LABEL[state.mode]}
      </span>

      {canControl && (
        <div className="ml-1 flex items-center gap-0.5">
          {isRunning ? (
            <Button onClick={pause} size="icon" variant="ghost" className="h-6 w-6" aria-label="Pause">
              <Pause className="h-3 w-3" />
            </Button>
          ) : (
            <Button onClick={start} size="icon" variant="ghost" className="h-6 w-6" aria-label="Start">
              <Play className="h-3 w-3" />
            </Button>
          )}
          <Button onClick={reset} size="icon" variant="ghost" className="h-6 w-6" aria-label="Reset">
            <RotateCcw className="h-3 w-3" />
          </Button>
          <select
            value={state.mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="ml-1 rounded-sm border bg-background px-1 py-0.5 text-[10px]"
            aria-label="Chọn mode"
          >
            <option value="FOCUS">25m</option>
            <option value="SHORT_BREAK">5m</option>
            <option value="LONG_BREAK">15m</option>
          </select>
        </div>
      )}
    </div>
  );
}
