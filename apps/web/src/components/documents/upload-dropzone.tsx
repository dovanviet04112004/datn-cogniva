/**
 * UploadDropzone — Client Component cho drag-drop + click-pick PDF.
 *
 * Dùng react-dropzone (giải quyết hết edge case: keyboard nav, paste,
 * a11y, multiple files). Phase 1 chỉ chấp nhận application/pdf.
 *
 * Sau khi upload thành công gọi `router.refresh()` để Server Component
 * `/documents` SSR lại danh sách. Cách này đơn giản hơn quản lý cache
 * thủ công + hot reload đồng bộ với DB thật.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

// 50 MB — match limit ở route handler (apps/web/src/app/api/documents/upload/route.ts)
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function UploadDropzone() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
      // 207 = file lưu nhưng ingest fail; 200 = full success
      const data = (await res.json().catch(() => null)) as
        | { status: 'READY' | 'FAILED'; filename: string; error?: string }
        | { error: string }
        | null;

      if (!res.ok && res.status !== 207) {
        const msg = data && 'error' in data ? data.error : `Upload failed (${res.status})`;
        toast.error(msg);
        return;
      }

      if (data && 'status' in data && data.status === 'FAILED') {
        toast.error(`${data.filename}: ${data.error ?? 'Ingest failed'}`);
      } else if (data && 'status' in data) {
        toast.success(`${data.filename} đã sẵn sàng`);
      }
      // Bất kể READY hay FAILED, list cần refresh để hiển thị status đúng
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi upload');
    } finally {
      setIsUploading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: MAX_FILE_BYTES,
    multiple: false,
    disabled: isUploading,
    onDrop: (accepted, rejected) => {
      if (rejected.length > 0) {
        const reason = rejected[0]?.errors[0]?.message ?? 'Invalid file';
        toast.error(reason);
        return;
      }
      const file = accepted[0];
      if (file) void handleUpload(file);
    },
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center transition-colors',
        isDragActive && !isDragReject && 'border-primary bg-primary/5',
        isDragReject && 'border-destructive bg-destructive/5',
        isUploading && 'pointer-events-none opacity-60',
      )}
    >
      <input {...getInputProps()} />
      {isUploading ? (
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      ) : (
        <FileUp className="h-8 w-8 text-muted-foreground" />
      )}
      <div className="space-y-0.5">
        <p className="text-sm font-medium">
          {isUploading
            ? 'Đang xử lý — parse + chunk + embed…'
            : isDragActive
              ? 'Thả file vào đây'
              : 'Kéo PDF vào hoặc bấm để chọn'}
        </p>
        <p className="text-xs text-muted-foreground">
          Tối đa 50 MB · Phase 1 chỉ nhận application/pdf
        </p>
      </div>
    </div>
  );
}
