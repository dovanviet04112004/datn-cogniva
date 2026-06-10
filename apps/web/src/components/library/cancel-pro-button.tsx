/**
 * CancelProButton — Phase 5 (2026-05-27).
 *
 * Hủy PRO sớm + refund prorated phần thời gian chưa dùng.
 *
 * UX: dùng ConfirmDialog shared (Dialog-based, không phải Radix AlertDialog
 * vì project chưa có). Hiển thị số ngày còn lại + ước tính refund trước khi
 * gọi API. Sau khi cancel → router.refresh() reload state PRO active.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { apiSend } from '@cogniva/shared/api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useT } from '@/lib/i18n/context';

const MONTHLY_PRICE = 199_000;
const MONTH_DAYS = 30;

export function CancelProButton({ proUntilAt }: { proUntilAt: string | null }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  // Ước tính refund client-side (server tính authoritative)
  const now = Date.now();
  const remainingDays = proUntilAt
    ? Math.max(0, (new Date(proUntilAt).getTime() - now) / 86400_000)
    : 0;
  const estimatedRefund = Math.round((remainingDays / MONTH_DAYS) * MONTHLY_PRICE);

  const cancel = async () => {
    try {
      const data = await apiSend<{
        ok?: boolean;
        refunded?: number;
        error?: string;
      }>('/api/library/cancel-pro', 'POST');
      if (!data.ok) throw new Error(data.error ?? t('library.cancel.failed'));
      if (data.refunded && data.refunded > 0) {
        toast.success(
          `${t('library.cancel.refunded_prefix')} ${data.refunded.toLocaleString('vi-VN')}đ ${t('library.cancel.refunded_suffix')}`,
        );
      } else {
        toast.success(t('library.cancel.no_refund'));
      }
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      throw err; // re-throw để ConfirmDialog biết thất bại (giữ dialog mở)
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1 border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
      >
        <XCircle className="h-3.5 w-3.5" />
        {t('library.cancel.button')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('library.cancel.confirm_title')}
        description={t('library.cancel.confirm_desc')
          .replace('{days}', remainingDays.toFixed(1))
          .replace('{refund}', estimatedRefund.toLocaleString('vi-VN'))}
        confirmLabel={t('library.cancel.confirm_label')}
        cancelLabel={t('library.cancel.cancel_label')}
        variant="destructive"
        onConfirm={cancel}
      />
    </>
  );
}
