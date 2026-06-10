/**
 * PomodoroTimer — đếm ngược 25/5/15 phút đồng bộ giữa các participant.
 *
 * Sync qua LiveKit data channel (lightweight, không cần realtime gateway). Mod
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
import { ComboSelect } from '@/components/ui/combo-select';
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
  /** Dùng trên nền TỐI (vd header voice tối) → style trắng/white-friendly. */
  dark?: boolean;
};

export function PomodoroTimer({ canControl, dark = false }: Props) {
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
      isInBreak
        ? 'border-emerald-500/30 bg-emerald-500/10'
        : dark
          ? 'border-white/15 bg-white/10 text-white'
          : 'bg-card',
    )}>
      {isInBreak && <Coffee className="h-3.5 w-3.5 text-emerald-500" />}
      <span className="font-mono text-base tabular-nums">
        {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
      </span>
      <span className={cn('hidden text-[10px] sm:inline', dark ? 'text-white/60' : 'text-muted-foreground')}>
        {MODE_LABEL[state.mode]}
      </span>

      {canControl && (
        <div className="ml-1 flex items-center gap-0.5">
          {isRunning ? (
            <Button onClick={pause} size="icon" variant="ghost" className={cn('h-6 w-6', dark && 'text-white hover:bg-white/15')} aria-label="Pause">
              <Pause className="h-3 w-3" />
            </Button>
          ) : (
            <Button onClick={start} size="icon" variant="ghost" className={cn('h-6 w-6', dark && 'text-white hover:bg-white/15')} aria-label="Start">
              <Play className="h-3 w-3" />
            </Button>
          )}
          {/* Reset + chọn mode chỉ hiện từ sm+ — header voice trên mobile rất chật,
              giấu cho gọn (cũng hết cái dropdown native trắng lạc tông). Mobile chỉ
              còn timer + play/pause. */}
          <span className="hidden items-center gap-0.5 sm:flex">
            <Button onClick={reset} size="icon" variant="ghost" className={cn('h-6 w-6', dark && 'text-white hover:bg-white/15')} aria-label="Reset">
              <RotateCcw className="h-3 w-3" />
            </Button>
            {/* Chọn mode — thay <select> native bằng ComboSelect (đồng tông design-system).
                value/options.value là string enum Mode, cast lại as Mode ở onChange. */}
            <ComboSelect
              value={state.mode}
              onChange={(v) => setMode(v as Mode)}
              options={[
                { value: 'FOCUS', label: '25m' },
                { value: 'SHORT_BREAK', label: '5m' },
                { value: 'LONG_BREAK', label: '15m' },
              ]}
              placeholder="Chọn mode"
              className="ml-1 w-24"
            />
          </span>
        </div>
      )}
    </div>
  );
}
