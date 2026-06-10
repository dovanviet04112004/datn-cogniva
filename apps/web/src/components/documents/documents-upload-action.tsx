/**
 * DocumentsUploadAction — nút "Upload" + dialog upload cho trang /documents.
 *
 * Trước đây trang /documents (list) KHÔNG có chỗ upload → user bấm quick-action
 * "Upload tài liệu" ở dashboard rồi đáp xuống 1 danh sách trơ, không làm gì được
 * (cảm giác "vô tác dụng"). Component này:
 *   1. Thêm nút Upload thật trên trang /documents.
 *   2. Tự MỞ dialog khi URL có `?upload=1` → dashboard deep-link
 *      `/documents?upload=1` đáp thẳng vào luồng upload (đã sẵn dropzone).
 *      Sau khi mở xong thì dọn param khỏi URL (replace, không thêm history).
 *   3. Upload xong → router.refresh() để list hiện tài liệu mới ngay.
 *
 * Client component vì cần useState (dialog) + useSearchParams + router.
 */
'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { UploadDocumentDialog } from './upload-document-dialog';

export function DocumentsUploadAction() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);

  // Auto-mở khi đáp trang với `?upload=1` (deep-link từ dashboard). Mở 1 lần rồi
  // gỡ param để F5 / share link sau không tự bật lại dialog.
  React.useEffect(() => {
    if (searchParams.get('upload') !== '1') return;
    setOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete('upload');
    const qs = next.toString();
    router.replace(qs ? `/documents?${qs}` : '/documents', { scroll: false });
  }, [searchParams, router]);

  // Controlled mode: dialog KHÔNG tự render trigger → nút Upload đặt riêng ở đây.
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Upload
      </Button>
      <UploadDocumentDialog
        open={open}
        onOpenChange={setOpen}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}
