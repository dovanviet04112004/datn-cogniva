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
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : data ? (
            <NoteEditor
              key={data.id}
              noteId={data.id}
              initialTitle={data.title}
              initialContent={data.content}
            />
          ) : (
            <p className="text-muted-foreground text-center text-sm">Note không tải được.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
