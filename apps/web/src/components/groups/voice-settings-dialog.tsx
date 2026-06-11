'use client';

import * as React from 'react';
import { Check, Keyboard, Mic, Radio, Zap } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { formatPttKey, useVoicePrefs, type VoiceMode } from '@/lib/group/voice-prefs';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

const MODE_META: Record<VoiceMode, { label: string; desc: string; icon: typeof Mic }> = {
  voice: {
    label: 'Voice Activity (mặc định)',
    desc: 'Tự động phát hiện khi bạn nói',
    icon: Mic,
  },
  ptt: {
    label: 'Push-to-Talk',
    desc: 'Chỉ unmute khi giữ phím (giảm noise môi trường)',
    icon: Radio,
  },
  open: {
    label: 'Always Open',
    desc: 'Mic luôn mở, không VAD — phù hợp study session',
    icon: Zap,
  },
};

export function VoiceSettingsDialog({ open, onOpenChange }: Props) {
  const { prefs, setMode, setPttKey } = useVoicePrefs();
  const [capturing, setCapturing] = React.useState(false);

  React.useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code) {
        setPttKey(e.code);
      }
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, setPttKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cài đặt voice</DialogTitle>
          <DialogDescription>
            Tuỳ chỉnh hành vi mic. Cài đặt lưu local — riêng cho thiết bị này.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-[10.5px] font-semibold uppercase tracking-wider">
              Chế độ mic
            </Label>
            <div className="space-y-1.5">
              {(['voice', 'ptt', 'open'] as VoiceMode[]).map((m) => {
                const meta = MODE_META[m];
                const Icon = meta.icon;
                const active = prefs.mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      'bg-card flex w-full items-start gap-3 rounded-md border p-3 text-left transition',
                      active
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-foreground/20 hover:bg-muted/40',
                    )}
                  >
                    <Icon
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        active ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium leading-tight">{meta.label}</p>
                      <p className="text-muted-foreground mt-0.5 text-[10.5px]">{meta.desc}</p>
                    </div>
                    {active && <Check className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {prefs.mode === 'ptt' && (
            <div className="space-y-2">
              <Label className="text-muted-foreground text-[10.5px] font-semibold uppercase tracking-wider">
                Phím Push-to-Talk
              </Label>
              <button
                type="button"
                onClick={() => setCapturing(true)}
                className={cn(
                  'bg-card flex w-full items-center gap-3 rounded-md border p-3 text-left transition',
                  capturing
                    ? 'border-primary bg-primary/5 animate-pulse'
                    : 'hover:border-foreground/20 hover:bg-muted/40',
                )}
              >
                <Keyboard className="text-muted-foreground h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium leading-tight">
                    {capturing ? 'Bấm phím muốn dùng…' : formatPttKey(prefs.pttKey)}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[10.5px]">
                    Phím sẽ unmute mic khi giữ. Default: Space.
                  </p>
                </div>
              </button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Xong</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
