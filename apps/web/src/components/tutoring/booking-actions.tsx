'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { usePrompt } from '@/lib/use-confirm';

export function BookingActions({
  bookingId,
  status,
  startAt,
  role,
  hasStudyGroup,
  onDone,
}: {
  bookingId: string;
  status: string;
  startAt: string;
  role: 'student' | 'tutor';
  hasStudyGroup: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const askPrompt = usePrompt();
  const [busy, setBusy] = React.useState<string | null>(null);

  const call = async (
    endpoint: string,
    payload?: Record<string, unknown>,
    successMsg = 'Thành công',
  ) => {
    setBusy(endpoint);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : `${res.status}`);
      }
      toast.success(successMsg);
      router.refresh();
      onDone?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cancelBooking = async (defaultReason?: string, successMsg = 'Đã huỷ booking') => {
    const reason = await askPrompt({
      title: 'Lý do huỷ (tuỳ chọn)',
      placeholder: 'Nhập lý do huỷ…',
      multiline: true,
      confirmLabel: 'Huỷ booking',
      cancelLabel: 'Quay lại',
    });
    if (reason === null) return;
    await call(
      `/api/tutoring/bookings/${bookingId}/cancel`,
      { reason: reason.trim() || defaultReason },
      successMsg,
    );
  };

  if (status === 'COMPLETED' || status === 'CANCELLED') return null;

  const endTime = new Date(startAt).getTime();
  const canMarkComplete = Date.now() > endTime;

  return (
    <div className="border-divider flex flex-wrap items-center justify-end gap-2 border-t pt-5">
      {role === 'tutor' && status === 'PENDING_TUTOR' && (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => cancelBooking('Tutor từ chối', 'Đã từ chối booking')}
            disabled={busy !== null}
          >
            <X className="mr-1 h-4 w-4" />
            Từ chối
          </Button>
          <Button
            type="button"
            onClick={() =>
              call(
                `/api/tutoring/bookings/${bookingId}/confirm`,
                undefined,
                'Đã xác nhận — phòng học đã tạo',
              )
            }
            disabled={busy !== null}
          >
            {busy?.endsWith('/confirm') ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1 h-4 w-4" />
            )}
            Xác nhận
          </Button>
        </>
      )}

      {role === 'student' && status === 'PENDING_TUTOR' && (
        <Button
          type="button"
          variant="outline"
          onClick={() => cancelBooking()}
          disabled={busy !== null}
        >
          <X className="mr-1 h-4 w-4" />
          Huỷ booking
        </Button>
      )}

      {status === 'CONFIRMED' && (
        <Button
          type="button"
          variant="outline"
          onClick={() => cancelBooking()}
          disabled={busy !== null}
        >
          <X className="mr-1 h-4 w-4" />
          Huỷ buổi
        </Button>
      )}

      {role === 'tutor' &&
        (status === 'CONFIRMED' || status === 'IN_PROGRESS') &&
        canMarkComplete && (
          <Button
            type="button"
            onClick={() =>
              call(
                `/api/tutoring/bookings/${bookingId}/complete`,
                undefined,
                'Đã đánh dấu hoàn thành',
              )
            }
            disabled={busy !== null}
          >
            {busy?.endsWith('/complete') ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1 h-4 w-4" />
            )}
            Đánh dấu hoàn thành
          </Button>
        )}

      {status === 'CONFIRMED' && !hasStudyGroup && (
        <p className="text-muted-foreground ml-auto text-[11px]">Đang chờ tạo phòng học...</p>
      )}
    </div>
  );
}
