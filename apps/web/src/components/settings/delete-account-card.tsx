/**
 * DeleteAccountCard — Danger Zone trong /settings.
 *
 * Plan v2 §10.4.3 + §15.1 W9-10 — GDPR Article 17 UI.
 *
 * 3 trạng thái:
 *   1. IDLE          — chưa request, hiện nút Delete
 *   2. PENDING       — đã request, hiện banner đỏ + nút Cancel + countdown
 *   3. CANCELLED     — vừa cancel, hiện toast confirmation (back to IDLE)
 *
 * Flow:
 *   IDLE → click "Delete account" → open confirm dialog
 *        → user gõ "DELETE MY ACCOUNT" + optional reason
 *        → POST /api/account/delete
 *        → state = PENDING với scheduledFor + countdown days
 *
 *   PENDING → click "Cancel deletion"
 *           → confirm dialog ngắn
 *           → DELETE /api/account/delete
 *           → state = IDLE
 *
 * Khi PENDING:
 *   - Banner đỏ TO ở top settings page (compliance — user phải thấy clearly)
 *   - Còn lại N days countdown
 *   - Button Cancel + thông tin "deletion permanent sau ngày X"
 */
'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type DeletionStatus = {
  pending: boolean;
  requestId?: string;
  scheduledFor?: string;
  daysRemaining?: number;
  canCancel?: boolean;
};

export function DeleteAccountCard() {
  const [status, setStatus] = React.useState<DeletionStatus | null>(null);
  const [showRequestDialog, setShowRequestDialog] = React.useState(false);
  const [showCancelDialog, setShowCancelDialog] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Initial fetch + poll mỗi 60s (rare update)
  React.useEffect(() => {
    const fetchStatus = () => {
      fetch('/api/account/delete')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: DeletionStatus | null) => d && setStatus(d))
        .catch(() => {});
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 60_000);
    return () => clearInterval(id);
  }, []);

  const requestDelete = async () => {
    if (confirmText !== 'DELETE MY ACCOUNT') {
      toast.error('Phải gõ chính xác "DELETE MY ACCOUNT" để confirm');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: confirmText,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.fieldErrors?.confirm?.[0] ?? data.error ?? 'Failed');
      }
      toast.success(
        `Đã đặt xoá account vào ngày ${new Date(data.scheduledFor).toLocaleDateString('vi-VN')}. ` +
          `Bạn có ${data.graceDays} ngày để hủy.`,
      );
      setShowRequestDialog(false);
      setConfirmText('');
      setReason('');
      // Refetch status
      const statusRes = await fetch('/api/account/delete');
      if (statusRes.ok) setStatus(await statusRes.json());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/account/delete', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      toast.success('Đã hủy yêu cầu xoá account.');
      setShowCancelDialog(false);
      setStatus({ pending: false });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // PENDING state — render banner đỏ
  if (status?.pending) {
    return (
      <>
        <Card className="border-destructive bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="flex-1">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-destructive">
                Account scheduled for deletion
              </h2>
              <p className="mt-1 text-sm">
                Account sẽ bị xoá VĨNH VIỄN vào{' '}
                <strong>{new Date(status.scheduledFor!).toLocaleDateString('vi-VN')}</strong>{' '}
                (còn <strong>{status.daysRemaining}</strong> ngày).
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sau ngày này: documents, flashcards, mastery, chat history sẽ bị xoá. Audit log + billing record giữ theo luật.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelDialog(true)}
                  disabled={!status.canCancel}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Hủy yêu cầu xoá
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Cancel confirm dialog */}
        <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Hủy yêu cầu xoá account?</DialogTitle>
              <DialogDescription>
                Account sẽ tiếp tục hoạt động bình thường. Bạn có thể yêu cầu xoá lại bất cứ lúc nào.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCancelDialog(false)}
                disabled={busy}
              >
                Không
              </Button>
              <Button onClick={cancelDelete} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Hủy yêu cầu xoá
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // IDLE state
  return (
    <>
      <Card className="border-destructive/30 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger Zone
        </h2>
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-sm font-medium">Export data</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tải xuống toàn bộ dữ liệu cá nhân theo GDPR Article 20 (JSON).
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={async () => {
                try {
                  const res = await fetch('/api/account/export', { method: 'POST' });
                  if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error ?? 'Export failed');
                  }
                  // Browser auto-download via Content-Disposition
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `cogniva-export-${Date.now()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success('Đã download data export');
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              Tải xuống data
            </Button>
          </div>

          <hr className="border-border" />

          <div>
            <p className="text-sm font-medium">Xoá account</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Xoá toàn bộ account + data sau 30 ngày grace period. Có thể hủy trong 30 ngày.
            </p>
            <Button
              variant="destructive"
              size="sm"
              className="mt-2"
              onClick={() => setShowRequestDialog(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Xoá account
            </Button>
          </div>
        </div>
      </Card>

      {/* Request confirm dialog */}
      <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Xoá vĩnh viễn account?</DialogTitle>
            <DialogDescription className="text-left">
              Sau 30 ngày grace, toàn bộ data sẽ bị xoá KHÔNG THỂ KHÔI PHỤC:
              <br />
              • Documents + flashcards + mastery history
              <br />
              • Chat conversations + AI responses
              <br />
              • Room messages + recordings (của room bạn own)
              <br />
              • Profile, settings, billing history
              <br />
              <br />
              Trước khi xoá, cân nhắc <strong>Tải xuống data</strong> để giữ lại bản backup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium" htmlFor="reason">
                Lý do (optional, ≤500 ký tự)
              </label>
              <input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Phản hồi giúp Cogniva improve..."
                maxLength={500}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium" htmlFor="confirm">
                Gõ <code className="rounded bg-muted px-1">DELETE MY ACCOUNT</code> để confirm
              </label>
              <input
                id="confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE MY ACCOUNT"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRequestDialog(false);
                setConfirmText('');
                setReason('');
              }}
              disabled={busy}
            >
              Không
            </Button>
            <Button
              variant="destructive"
              onClick={requestDelete}
              disabled={busy || confirmText !== 'DELETE MY ACCOUNT'}
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Xác nhận xoá account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
