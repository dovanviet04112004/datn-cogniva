'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { usePrompt } from '@/lib/use-confirm';

export function KycDocActions({ docId, currentStatus }: { docId: string; currentStatus: string }) {
  const router = useRouter();
  const askPrompt = usePrompt();
  const [busy, setBusy] = React.useState<string | null>(null);

  const act = async (action: 'APPROVE' | 'REJECT') => {
    let note: string | null = null;
    if (action === 'REJECT') {
      note = await askPrompt({
        title: 'Lý do từ chối',
        description: 'Sẽ gửi cho gia sư.',
        placeholder: 'Nhập lý do…',
        multiline: true,
      });
      if (!note) return;
    }
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/kyc/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note ?? undefined }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Action lỗi');
      }
      toast.success(action === 'APPROVE' ? 'Đã duyệt' : 'Đã từ chối');
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (currentStatus === 'APPROVED') {
    return (
      <Button size="sm" variant="ghost" onClick={() => act('REJECT')} disabled={busy !== null}>
        {busy === 'REJECT' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
        <span className="ml-1 text-xs">Huỷ duyệt</span>
      </Button>
    );
  }

  if (currentStatus === 'REJECTED') {
    return (
      <Button size="sm" variant="outline" onClick={() => act('APPROVE')} disabled={busy !== null}>
        {busy === 'APPROVE' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        <span className="ml-1 text-xs">Duyệt lại</span>
      </Button>
    );
  }

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" onClick={() => act('REJECT')} disabled={busy !== null}>
        {busy === 'REJECT' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
        <span className="ml-1 text-xs">Từ chối</span>
      </Button>
      <Button size="sm" onClick={() => act('APPROVE')} disabled={busy !== null}>
        {busy === 'APPROVE' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        <span className="ml-1 text-xs">Duyệt</span>
      </Button>
    </div>
  );
}
