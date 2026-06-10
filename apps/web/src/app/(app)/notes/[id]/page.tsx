/**
 * /notes/[id] — load note + render NoteEditor (TipTap + autosave + AI).
 *
 * Client-only: fetch /api/notes/[id] khi mount.
 */
'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import type { NoteDTO } from '@cogniva/shared/types';
import { PageShell } from '@/components/layout/page-shell';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { PageLoading } from '@/components/layout/page-loading';
import { EmptyState } from '@/components/layout/empty-state';
import { NoteEditor } from '@/components/notes/note-editor';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function NotePage({ params }: PageProps) {
  const { id } = use(params);
  // React Query: cache + revalidate, share cache với NoteEditorDialog (cùng key).
  const { data: note, error } = useQuery({
    queryKey: qk.note(id),
    queryFn: () => apiGet<{ note: NoteDTO }>(`/api/notes/${id}`).then((d) => d.note),
  });

  if (error) {
    return (
      <PageShell size="narrow">
        <EmptyState title="Không load được note" description={(error as Error).message} />
      </PageShell>
    );
  }
  if (!note) {
    return (
      <PageShell size="narrow">
        <PageLoading label="Đang tải note..." />
      </PageShell>
    );
  }

  return (
    <PageShell size="narrow">
      <Breadcrumbs
        segments={[
          { href: '/notes', label: 'Notes' },
          { label: note.title || 'Untitled' },
        ]}
      />
      <NoteEditor
        noteId={note.id}
        initialTitle={note.title}
        initialContent={note.content}
      />
    </PageShell>
  );
}
