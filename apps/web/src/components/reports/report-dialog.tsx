'use client';

import * as React from 'react';
import { AlertOctagon, Flag, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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
const MAX_REASON_LEN = 1000;

const QUICK_REASONS = [
  'Spam hoặc quảng cáo',
  'Quấy rối / lăng mạ',
  'Nội dung khiêu dâm',
  'Bạo lực / nguy hiểm',
  'Lừa đảo / phishing',
  'Vi phạm bản quyền',
  'Khác (mô tả bên dưới)',
];

export type ReportTargetType =
  | 'group_message'
  | 'ai_message'
  | 'user'
  | 'document'
  | 'group'
  | 'conversation';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: ReportTargetType;
  targetId: string;
  targetLabel?: string;
};

export function ReportDialog({ open, onOpenChange, targetType, targetId, targetLabel }: Props) {
  const [category, setCategory] = React.useState<string>(QUICK_REASONS[0]!);
  const [detail, setDetail] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setCategory(QUICK_REASONS[0]!);
        setDetail('');
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const fullReason = detail.trim() ? `${category} — ${detail.trim()}` : category;
  const reasonValid = fullReason.length >= MIN_REASON_LEN && fullReason.length <= MAX_REASON_LEN;

  const submit = async () => {
    if (!reasonValid || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, reason: fullReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast.info('Bạn đã báo cáo nội dung này trong 24h qua.');
        onOpenChange(false);
        return;
      }
      if (!res.ok) {
        throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? 'Báo cáo thất bại');
      }
      toast.success('Đã gửi báo cáo. Đội ngũ kiểm duyệt sẽ xem xét.');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Báo cáo thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-amber-500" />
            Báo cáo nội dung
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs leading-relaxed">
            {targetLabel ? (
              <>
                Bạn đang báo cáo: <strong>{targetLabel}</strong>. Vui lòng chọn loại vi phạm và mô
                tả ngắn gọn. Báo cáo sai sự thật có thể bị xử lý.
              </>
            ) : (
              <>
                Vui lòng chọn loại vi phạm và mô tả ngắn gọn. Đội ngũ kiểm duyệt sẽ xem xét trong
                24h.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Loại vi phạm <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCategory(r)}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-left text-[11.5px] font-medium transition-colors',
                    category === r
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="report-detail" className="text-xs font-medium">
              Mô tả chi tiết{' '}
              <span className="text-muted-foreground ml-1 font-mono text-[10px]">
                (không bắt buộc, tối đa {MAX_REASON_LEN} ký tự)
              </span>
            </label>
            <textarea
              id="report-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              maxLength={MAX_REASON_LEN}
              disabled={loading}
              placeholder="Ví dụ: User này spam link cờ bạc vào group chat nhiều lần…"
              className="border-border bg-background placeholder:text-muted-foreground w-full resize-none rounded-md border px-3 py-2 text-sm focus:border-amber-500/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
            <p className="text-muted-foreground text-right font-mono text-[10px] tabular-nums">
              {detail.length}/{MAX_REASON_LEN}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Huỷ
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={loading || !reasonValid}
            className="bg-amber-500 text-white hover:bg-amber-600"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Đang gửi…
              </>
            ) : (
              <>
                <Flag className="mr-1.5 h-3.5 w-3.5" />
                Gửi báo cáo
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
