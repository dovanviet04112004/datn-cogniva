/**
 * DocumentDetailActions — shortcut header cho document detail (trang /documents/[id]).
 *
 * Chỉ còn DUY NHẤT lối "Mở trong workspace". Tạo flashcard/quiz KHÔNG còn làm rời
 * theo tài liệu ở đây nữa — toàn bộ việc sinh thẻ/quiz dồn vào workspace notebook
 * (chọn atom ở cột Sources → Studio "Tạo thẻ/quiz"). Tránh 2 lối tạo song song
 * lệch nhau + để trạng thái học atom luôn cập nhật đúng một nơi.
 *
 * Ẩn hẳn nếu doc chưa gắn workspaceId (không có đích để mở).
 */
'use client';

import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';

type Props = {
  /** WorkspaceId của doc — đích mở workspace notebook. Null → ẩn button. */
  workspaceId?: string | null;
};

export function DocumentDetailActions({ workspaceId }: Props) {
  if (!workspaceId) return null;

  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={`/workspaces/${workspaceId}?view=chat`}>
        <MessageSquare className="mr-1 h-3.5 w-3.5" />
        Mở trong workspace
      </Link>
    </Button>
  );
}
