/**
 * ConfirmDialog — modal xác nhận tuỳ chỉnh thay native `confirm()`.
 *
 * Native dialog của browser:
 *   - URL prefix "localhost:3000 cho biết" trông rẻ tiền
 *   - Không match theme dark/light
 *   - Không customize được button label / variant
 *
 * Component này:
 *   - Title + description rõ ràng
 *   - Confirm button có variant 'destructive' cho action xoá
 *   - Disabled state khi đang submit (chống double-click)
 *   - Tự đóng sau khi confirm OK
 *   - Cancel button + ESC + click overlay đóng
 *
 * Cách dùng:
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Xoá tin nhắn?"
 *     description="Hành động này không thể hoàn tác."
 *     onConfirm={async () => { await deleteMsg(); }}
 *     variant="destructive"
 *   />
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

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'destructive' đỏ nền cho xoá; 'default' primary cho action bình thường. */
  variant?: 'destructive' | 'default';
  /**
   * Async — nếu return reject, modal vẫn đóng (caller tự toast error nếu cần).
   * Đợi xong mới đóng → user thấy spinner trong lúc network call.
   */
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  variant = 'default',
  onConfirm,
}: Props) {
  const [busy, setBusy] = React.useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Caller xử lý toast — không để rethrow crash UI
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
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={busy}
            autoFocus
          >
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
