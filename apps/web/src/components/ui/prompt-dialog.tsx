/**
 * PromptDialog — modal nhập 1 dòng text, thay native `prompt()`.
 *
 * Native `prompt()` cùng vấn đề với confirm(): prefix "localhost cho biết",
 * không theme, block thread. Component này cho input styled + nút Xác nhận/Huỷ.
 * Dùng qua hook usePrompt (xem lib/use-confirm.tsx) — mount 1 lần ở provider.
 */
'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Bắt buộc nhập (không cho submit rỗng). */
  required?: boolean;
  multiline?: boolean;
  /** Trả về value đã nhập; modal đóng sau khi resolve. */
  onSubmit: (value: string) => void | Promise<void>;
};

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  required = false,
  multiline = false,
  onSubmit,
}: Props) {
  const [value, setValue] = React.useState(defaultValue);
  const [busy, setBusy] = React.useState(false);

  // Reset value mỗi lần mở (defaultValue có thể đổi giữa các lần gọi).
  React.useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const canSubmit = !required || value.trim().length > 0;

  const handleSubmit = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    try {
      await onSubmit(value);
      onOpenChange(false);
    } catch {
      /* caller tự toast */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {multiline ? (
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={3}
            autoFocus
          />
        ) : (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !canSubmit}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
