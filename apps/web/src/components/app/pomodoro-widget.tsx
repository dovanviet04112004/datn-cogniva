'use client';

import * as React from 'react';
import { Coffee, Pause, Play, RotateCcw, Timer } from 'lucide-react';

import { usePomodoroEnabled } from './use-pomodoro-enabled';

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;
const STORAGE_KEY = 'cogniva.pomodoro.v1';

type Phase = 'IDLE' | 'FOCUS' | 'BREAK';

type State = {
  phase: Phase;
  remaining: number;
  cycle: number;
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

function notify(title: string, body: string) {
  if (typeof window === 'undefined') return;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/favicon.ico' });
    } catch {}
  }
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
  } catch {}
}

export function PomodoroWidget() {
  const [enabled] = usePomodoroEnabled();
  const [state, setState] = React.useState<State>(defaultState);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        setState({ ...parsed, running: false });
      }
    } catch {}
    setHydrated(true);
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  React.useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  React.useEffect(() => {
    if (!state.running) return;
    const interval = setInterval(() => {
      setState((prev) => {
        if (!prev.running) return prev;
        if (prev.remaining > 1) {
          return { ...prev, remaining: prev.remaining - 1 };
        }
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
      ? 'text-destructive'
      : state.phase === 'BREAK'
        ? 'text-success'
        : 'text-muted-foreground';

  if (!enabled) return null;

  return (
    <div className="hidden items-center gap-1 rounded-md border px-2 py-1 sm:flex">
      <Icon className={`h-3.5 w-3.5 ${phaseColor}`} />
      <span className="text-xs font-medium tabular-nums" suppressHydrationWarning>
        {formatTime(state.remaining)}
      </span>
      <button
        onClick={toggle}
        className="hover:bg-muted ml-1 inline-flex h-6 w-6 items-center justify-center rounded"
        aria-label={state.running ? 'Tạm dừng Pomodoro' : 'Bắt đầu Pomodoro'}
      >
        {state.running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      {state.phase !== 'IDLE' && (
        <button
          onClick={reset}
          className="hover:bg-muted inline-flex h-6 w-6 items-center justify-center rounded"
          aria-label="Reset"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
      {state.cycle > 0 && (
        <span className="text-muted-foreground ml-1 text-[11px]">×{state.cycle}</span>
      )}
    </div>
  );
}
