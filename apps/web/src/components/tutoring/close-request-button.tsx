/**
 * CloseRequestButton — chủ yêu cầu đóng yêu cầu tìm gia sư (status → CLOSED).
 *
 * Dùng khi đã tìm được gia sư ngoài luồng / không cần nữa. Gọi PATCH
 * /api/tutoring/requests/[id] { status: 'CLOSED' } rồi refresh.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { useConfirm } from '@/lib/use-confirm';

export function CloseRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = React.useState(false);

  const close = async () => {
    const ok = await confirm({
      title: 'Đóng yêu cầu này?',
      description: 'Gia sư sẽ không ứng tuyển được nữa.',
      confirmLabel: 'Đóng yêu cầu',
      variant: 'destructive',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tutoring/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CLOSED' }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Đóng yêu cầu thất bại');
      }
      toast.success('Đã đóng yêu cầu');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={close}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-xl border border-divider px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
      Đóng yêu cầu
    </button>
  );
}
