'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

type UploadResponse =
  | { status: 'READY' | 'FAILED'; filename: string; error?: string }
  | { error: string }
  | null;

export function useDocumentUpload() {
  const router = useRouter();
  const [isUploading, setIsUploading] = React.useState(false);

  const upload = React.useCallback(
    async (file: File, workspaceId: string) => {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`File quá lớn — tối đa ${MAX_FILE_BYTES / 1024 / 1024}MB`);
        return;
      }
      if (file.type !== 'application/pdf') {
        toast.error('Chỉ chấp nhận PDF');
        return;
      }
      if (!workspaceId) {
        toast.error('Hãy chọn workspace để upload vào');
        return;
      }

      setIsUploading(true);
      const form = new FormData();
      form.append('file', file);
      form.append('workspaceId', workspaceId);

      try {
        const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
        const data = (await res.json().catch(() => null)) as UploadResponse;

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
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi upload');
      } finally {
        setIsUploading(false);
      }
    },
    [router],
  );

  return { upload, isUploading };
}
