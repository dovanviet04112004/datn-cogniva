/**
 * Pill hiển thị trạng thái tài liệu — map trực tiếp từ enum doc_status.
 * Server Component (không có "use client") để render ngay khi list page SSR.
 */
import { CheckCircle2, Loader2, XCircle, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

type Status = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

const config: Record<Status, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary'; Icon: typeof CheckCircle2 }> = {
  UPLOADING: { label: 'Uploading', variant: 'secondary', Icon: Upload },
  PROCESSING: { label: 'Processing', variant: 'warning', Icon: Loader2 },
  READY: { label: 'Ready', variant: 'success', Icon: CheckCircle2 },
  FAILED: { label: 'Failed', variant: 'destructive', Icon: XCircle },
};

export function StatusBadge({ status }: { status: Status }) {
  const { label, variant, Icon } = config[status];
  // PROCESSING dùng icon spin; các status khác static
  const spin = status === 'PROCESSING' ? 'animate-spin' : '';
  return (
    <Badge variant={variant} className="font-medium">
      <Icon className={`h-3 w-3 ${spin}`} />
      {label}
    </Badge>
  );
}
