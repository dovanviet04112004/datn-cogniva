/**
 * PomodoroWidget — đồng hồ Pomodoro 25/5 trong topbar.
 *
 * State machine:
 *   IDLE → click "Bắt đầu" → FOCUS (25 phút) → khi countdown=0 → BREAK (5 phút)
 *     → khi countdown=0 → FOCUS lần kế (cycle++). Cycle 4 → long break (15 phút).
 *
 * UX:
 *   - Topbar: hiển thị MM:SS + nút play/pause + nút reset.
 *   - localStorage giữ state qua reload.
 *   - Notification + sound khi 1 phase xong (browser permission).
 *
 * Phase 7 v1: client-only, không lưu DB. Phase sau có thể log studySession.
 */
'use client';

import * as React from 'react';
import { Coffee, Pause, Play, RotateCcw, Timer } from 'lucide-react';

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;
const STORAGE_KEY = 'cogniva.pomodoro.v1';

type Phase = 'IDLE' | 'FOCUS' | 'BREAK';

type State = {
  phase: Phase;
  remaining: number;
  cycle: number; // số lần FOCUS đã xong (resetable)
  running: boolean;
};

function defaultState(): State {
  return { phase: 'IDLE', remaining: FOCUS_SECONDS, cycle: 0, running: false };
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Gửi browser notification + chuông nếu permission granted. */
function notify(title: string, body: string) {
  if (typeof window === 'undefined') return;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/favicon.ico' });
    } catch {
      /* iOS Safari ko hỗ trợ — bỏ qua */
    }
  }
  // Beep ngắn qua Web Audio API — không cần asset file
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    /* SSR safe */
  }
}

export function PomodoroWidget() {
  const [state, setState] = React.useState<State>(defaultState);
  const [hydrated, setHydrated] = React.useState(false);

  // Load từ localStorage 1 lần
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        setState({ ...parsed, running: false }); // restart paused để user chủ động
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
    // Xin permission notification 1 lần
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Persist mỗi khi state đổi
  React.useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  // Countdown tick
  React.useEffect(() => {
    if (!state.running) return;
    const interval = setInterval(() => {
      setState((prev) => {
        if (!prev.running) return prev;
        if (prev.remaining > 1) {
          return { ...prev, remaining: prev.remaining - 1 };
        }
        // Hết phase — chuyển kế tiếp
        if (prev.phase === 'FOCUS') {
          const newCycle = prev.cycle + 1;
          const isLong = newCycle % 4 === 0;
          notify('Pomodoro', `Hết 25 phút — nghỉ ${isLong ? '15' : '5'} phút!`);
          return {
            phase: 'BREAK',
            remaining: isLong ? LONG_BREAK_SECONDS : BREAK_SECONDS,
            cycle: newCycle,
            running: true,
          };
        }
        // BREAK xong → FOCUS lần kế tiếp (paused chờ user start)
        notify('Pomodoro', 'Nghỉ xong — sẵn sàng focus tiếp!');
        return {
          phase: 'IDLE',
          remaining: FOCUS_SECONDS,
          cycle: prev.cycle,
          running: false,
        };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [state.running]);

  const toggle = () => {
    setState((s) => {
      if (s.phase === 'IDLE') {
        return { ...s, phase: 'FOCUS', remaining: FOCUS_SECONDS, running: true };
      }
      return { ...s, running: !s.running };
    });
  };

  const reset = () => setState(defaultState());

  const Icon = state.phase === 'BREAK' ? Coffee : Timer;
  const phaseColor =
    state.phase === 'FOCUS'
      ? 'text-red-500'
      : state.phase === 'BREAK'
        ? 'text-green-500'
        : 'text-muted-foreground';

  return (
    <div className="hidden items-center gap-1 rounded-md border px-2 py-1 sm:flex">
      <Icon className={`h-3.5 w-3.5 ${phaseColor}`} />
      <span className="tabular-nums text-xs font-medium" suppressHydrationWarning>
        {formatTime(state.remaining)}
      </span>
      <button
        onClick={toggle}
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
        aria-label={state.running ? 'Tạm dừng Pomodoro' : 'Bắt đầu Pomodoro'}
      >
        {state.running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      {state.phase !== 'IDLE' && (
        <button
          onClick={reset}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
          aria-label="Reset"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
      {state.cycle > 0 && (
        <span className="ml-1 text-[10px] text-muted-foreground">×{state.cycle}</span>
      )}
    </div>
  );
}
