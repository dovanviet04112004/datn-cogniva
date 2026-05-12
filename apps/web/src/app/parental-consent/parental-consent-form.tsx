/**
 * Client form cho parent submit consent decision.
 *
 * Tách client component vì server page chỉ render data, form action cần JS.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

type Props = {
  token: string;
  childName: string;
};

type ResponseData = {
  ok: boolean;
  decision: 'VERIFY' | 'REJECT';
  newStatus: string;
};

export function ParentalConsentForm({ token, childName }: Props) {
  const router = useRouter();
  const [parentName, setParentName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ResponseData | null>(null);

  const submit = async (decision: 'VERIFY' | 'REJECT') => {
    if (decision === 'REJECT' && !window.confirm(
      `Từ chối sẽ khóa vĩnh viễn account của ${childName}. Tiếp tục?`,
    )) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/parental-consent/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          decision,
          parentName: parentName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? data.error ?? 'Failed');
      }
      setResult(data);
      toast.success(
        decision === 'VERIFY'
          ? `Đã đồng ý cho ${childName}. Account đã unlock.`
          : `Đã từ chối account ${childName}.`,
      );
      // Refresh để page re-render with new status (AlreadyRespondedView)
      setTimeout(() => router.refresh(), 1500);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div
        className={`mt-6 rounded-md border p-4 ${
          result.decision === 'VERIFY'
            ? 'border-green-500/40 bg-green-50 dark:bg-green-950/30'
            : 'border-red-500/40 bg-red-50 dark:bg-red-950/30'
        }`}
      >
        <p className="font-medium">
          {result.decision === 'VERIFY' ? '✓ Đã đồng ý' : '✗ Đã từ chối'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Quyết định của bạn đã được ghi nhận.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div>
        <label htmlFor="parent-name" className="text-sm font-medium">
          Tên của bạn (tùy chọn, cho audit log)
        </label>
        <input
          id="parent-name"
          type="text"
          value={parentName}
          onChange={(e) => setParentName(e.target.value)}
          maxLength={80}
          placeholder="Nguyễn Văn A"
          className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          onClick={() => submit('VERIFY')}
          disabled={busy}
          className="flex-1"
        >
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
          Đồng ý — Tôi là cha mẹ / người giám hộ
        </Button>
        <Button
          onClick={() => submit('REJECT')}
          disabled={busy}
          variant="destructive"
        >
          <X className="mr-1 h-4 w-4" />
          Từ chối
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Bằng cách click &ldquo;Đồng ý&rdquo;, bạn xác nhận là cha mẹ hoặc người giám
        hộ hợp pháp của {childName}, đã đọc Privacy Policy + COPPA Notice, và đồng
        ý cho Cogniva thu thập + xử lý dữ liệu học tập của con bạn theo các điều
        khoản đó.
      </p>
    </div>
  );
}
