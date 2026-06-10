/**
 * NoteEditorDialog — V8.12 (2026-05-20).
 *
 * Modal in-workspace edit note, reuse `<NoteEditor>` (TipTap + autosave).
 * V8.12: bỏ link "Mở full page" /notes/[id] (theo feedback "vẫn đang gắn
 * vài link mở sáng trang note cũ"). Toàn bộ flow note giờ ở-trong-workspace.
 *
 * Fetch /api/notes/[id] khi mở để lấy title + content hiện tại.
 *
 * NoteEditor autosave qua PATCH /api/notes/[id], đóng dialog không mất data.
 */
'use client';

import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import type { NoteDTO } from '@cogniva/shared/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NoteEditor } from '@/components/notes/note-editor';

type Props = {
  noteId: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
};

export function NoteEditorDialog({ noteId, open, onOpenChange }: Props) {
  // Share cache với /notes/[id] (cùng qk.note) → mở dialog note đã xem hiện ngay,
  // revalidate ngầm. Chỉ fetch khi dialog mở + có noteId.
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.note(noteId ?? ''),
    queryFn: () => apiGet<{ note: NoteDTO }>(`/api/notes/${noteId}`).then((d) => d.note),
    enabled: open && !!noteId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[800px] w-[90vw] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3 pr-12 text-left">
          <DialogTitle className="text-base">
            {data?.title || (loading ? 'Đang tải…' : 'Note')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Chỉnh sửa nội dung note với autosave.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !data ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : data ? (
            <NoteEditor
              key={data.id}
              noteId={data.id}
              initialTitle={data.title}
              initialContent={data.content}
            />
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Note không tải được.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
