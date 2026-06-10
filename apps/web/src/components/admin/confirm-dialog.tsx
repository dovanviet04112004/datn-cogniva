/**
 * ConfirmDialog — modal xác nhận với textarea bắt buộc cho destructive admin
 * action. Pattern docs/plans/admin.md §4.4: reason min 10 chars, button disabled
 * tới khi reason đủ length, audit log ghi reason.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   const [loading, setLoading] = useState(false);
 *   ...
 *   <Button onClick={() => setOpen(true)} variant="destructive">Suspend</Button>
 *   <ConfirmDialog
 *     open={open} onOpenChange={setOpen}
 *     title="Suspend user X?"
 *     description="..."
 *     confirmLabel="Suspend"
 *     variant="destructive"
 *     loading={loading}
 *     onConfirm={async (reason) => {
 *       setLoading(true);
 *       try { await fetch(...); } finally { setLoading(false); setOpen(false); }
 *     }}
 *   />
 */
'use client';

import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MIN_REASON_LEN = 10;
const MAX_REASON_LEN = 500;

type Variant = 'destructive' | 'warning' | 'default';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: Variant;
  /** Khi false, không yêu cầu reason (vd action không destructive). */
  reasonRequired?: boolean;
  loading?: boolean;
  /** Callback nhận reason đã trim. Bao try/catch + setOpen(false) bên caller. */
  onConfirm: (reason: string) => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Huỷ',
  variant = 'destructive',
  reasonRequired = true,
  loading = false,
  onConfirm,
}: Props) {
  const [reason, setReason] = React.useState('');

  // Reset reason khi dialog close
  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setReason(''), 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const trimmedLen = reason.trim().length;
  const reasonValid =
    !reasonRequired ||
    (trimmedLen >= MIN_REASON_LEN && trimmedLen <= MAX_REASON_LEN);

  const handleConfirm = async () => {
    if (!reasonValid) return;
    await onConfirm(reason.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {variant !== 'default' && (
              <AlertTriangle
                className={cn(
                  'h-4 w-4',
                  variant === 'destructive' ? 'text-red-500' : 'text-amber-500',
                )}
              />
            )}
            {title}
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>

        {reasonRequired && (
          <div className="space-y-1.5">
            <label
              htmlFor="confirm-reason"
              className="text-xs font-medium text-slate-300"
            >
              Lý do <span className="text-red-400">*</span>
              <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                ({MIN_REASON_LEN}-{MAX_REASON_LEN} ký tự, ghi audit log)
              </span>
            </label>
            <textarea
              id="confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={MAX_REASON_LEN}
              disabled={loading}
              placeholder="Ví dụ: User spam group A nhiều lần, đã warning 2 lần."
              className="w-full resize-none rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            />
            <p
              className={cn(
                'text-right font-mono text-[10px] tabular-nums',
                trimmedLen < MIN_REASON_LEN
                  ? 'text-slate-500'
                  : 'text-emerald-500',
              )}
            >
              {trimmedLen}/{MAX_REASON_LEN}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !reasonValid}
            className={cn(
              variant === 'destructive' && 'bg-red-500 text-white hover:bg-red-600',
              variant === 'warning' && 'bg-amber-500 text-white hover:bg-amber-600',
            )}
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Đang xử lý…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
