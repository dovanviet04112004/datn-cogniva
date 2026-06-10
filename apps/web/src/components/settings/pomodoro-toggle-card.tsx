/**
 * PomodoroToggleCard — section trong /settings để bật/tắt Pomodoro widget
 * trên topbar.
 *
 * Pref lưu localStorage qua hook `usePomodoroEnabled`. Toggle ở đây tự sync
 * sang topbar (cross-tab qua storage event).
 */
'use client';

import * as React from 'react';
import { Timer } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { usePomodoroEnabled } from '@/components/app/use-pomodoro-enabled';

export function PomodoroToggleCard() {
  const [enabled, setEnabled] = usePomodoroEnabled();

  return (
    <Card className="space-y-3 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Timer className="h-4 w-4" />
        Pomodoro Timer
      </h2>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium">Hiện Pomodoro trên topbar</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Đồng hồ học 25 phút / nghỉ 5 phút (chu kỳ 4 lần → nghỉ dài 15 phút).
            Khi bật, widget xuất hiện ở góc trên phải.
          </p>
        </div>
        {/* Switch — minimal HTML toggle với Tailwind */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-md transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </Card>
  );
}
