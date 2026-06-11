'use client';

import * as React from 'react';
import { Timer } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { usePomodoroEnabled } from '@/lib/use-pomodoro-enabled';

export function PomodoroToggleCard() {
  const [enabled, setEnabled] = usePomodoroEnabled();

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
        <Timer className="h-4 w-4" />
        Pomodoro Timer
      </h2>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium">Hiện Pomodoro trên topbar</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Đồng hồ học 25 phút / nghỉ 5 phút (chu kỳ 4 lần → nghỉ dài 15 phút). Khi bật, widget
            xuất hiện ở góc trên phải.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`focus-visible:ring-ring relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`bg-background pointer-events-none inline-block h-5 w-5 rounded-full shadow-md transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </Card>
  );
}
