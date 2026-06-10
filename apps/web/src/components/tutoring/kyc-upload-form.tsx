/**
 * KycUploadForm — tutor upload CCCD + bằng cấp.
 *
 * 4 doc type required cho KYC_VERIFIED:
 *   - CCCD_FRONT, CCCD_BACK, DEGREE (≥1), CERTIFICATE (optional)
 *
 * Mỗi card render input file + preview + status badge nếu đã upload.
 * Sau upload thành công, list refresh và profile chuyển KYC_PENDING.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileUp, Loader2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

export type KycDocRecord = {
  id: string;
  docType: string;
  storageKey: string;
  originalName: string;
  status: string;
  reviewNote: string | null;
  createdAt: string;
};

const DOC_FIELDS = [
  {
    type: 'CCCD_FRONT',
    label: 'CCCD mặt trước',
    description: 'Ảnh chụp rõ mặt trước căn cước công dân',
    required: true,
  },
  {
    type: 'CCCD_BACK',
    label: 'CCCD mặt sau',
    description: 'Ảnh chụp rõ mặt sau căn cước',
    required: true,
  },
  {
    type: 'DEGREE',
    label: 'Bằng cấp / Học bạ',
    description: 'Bằng tốt nghiệp, học bạ, hoặc bảng điểm',
    required: true,
  },
  {
    type: 'CERTIFICATE',
    label: 'Chứng chỉ chuyên môn',
    description: 'IELTS/TOEFL, chứng chỉ giảng dạy... (tuỳ chọn)',
    required: false,
  },
] as const;

const STATUS_LABELS: Record<string, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  PENDING: {
    label: 'Đang chờ duyệt',
    color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20',
    Icon: Clock,
  },
  APPROVED: {
    label: 'Đã duyệt',
    color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20',
    Icon: CheckCircle2,
  },
  REJECTED: {
    label: 'Bị từ chối',
    color: 'bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20',
    Icon: XCircle,
  },
};

export function KycUploadForm({
  tutorId,
  initialDocs,
}: {
  tutorId: string;
  initialDocs: KycDocRecord[];
}) {
  const router = useRouter();
  const [docs, setDocs] = React.useState(initialDocs);
  const [uploading, setUploading] = React.useState<string | null>(null);

  const upload = async (docType: string, file: File) => {
    setUploading(docType);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', docType);
      fd.append('originalName', file.name);
      const res = await fetch(`/api/tutors/${tutorId}/kyc`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Upload lỗi');
      }
      const data = (await res.json()) as { document: KycDocRecord };
      toast.success(`Đã upload ${file.name}`);
      setDocs((prev) => [data.document, ...prev]);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="space-y-3">
      {DOC_FIELDS.map((field) => {
        const myDocs = docs
          .filter((d) => d.docType === field.type)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const latest = myDocs[0];

        return (
          <div
            key={field.type}
            className="rounded-2xl bg-card p-5 shadow-soft"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold tracking-tight">
                    {field.label}
                  </p>
                  {field.required && (
                    <span className="text-[10px] font-semibold text-primary">
                      *
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {field.description}
                </p>
              </div>
              {latest && (
                <StatusBadge status={latest.status} />
              )}
            </div>

            {latest && (
              <div className="mt-3 rounded-xl bg-muted/30 px-3 py-2 text-[12px]">
                <p className="truncate font-mono text-[11px]">
                  {latest.originalName}
                </p>
                {latest.reviewNote && (
                  <p className="mt-1 text-[11.5px] text-amber-700 dark:text-amber-400">
                    Note admin: {latest.reviewNote}
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              <label
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-divider bg-surface px-3 py-1.5 text-xs font-medium shadow-soft transition-colors hover:bg-muted',
                  uploading === field.type && 'pointer-events-none opacity-60',
                )}
              >
                {uploading === field.type ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileUp className="h-3.5 w-3.5" />
                )}
                {latest ? 'Upload lại' : 'Chọn file'}
                <input
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(field.type, f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_LABELS[status] ?? STATUS_LABELS.PENDING!;
  const Icon = cfg.Icon;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        cfg.color,
      )}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
