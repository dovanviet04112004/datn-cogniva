/**
 * NotePreviewContext — V8.12 (2026-05-20).
 *
 * Quản lý state preview note trong workspace:
 *   - mode='inline': hiện trong sidebar Sources (compact preview)
 *   - mode='modal': hiện modal full editor (TipTap)
 *
 * Flow chuẩn (giống Doc + Atom):
 *   1. Click note row trong Sources → openNote(id) → mode='inline'
 *   2. Click zoom button trong inline → setMode('modal')
 *   3. Modal X → back to inline (setMode('inline'))
 *   4. Inline X → close (null)
 *
 * Coexist với DocPreview + AtomPreview: mở note → close 2 cái kia, do
 * handler click ở SourcesPanel xử lý.
 */
'use client';

import * as React from 'react';

export type NotePreviewMode = 'inline' | 'modal';

export type NotePreviewContextValue = {
  noteId: string | null;
  mode: NotePreviewMode;
  /**
   * Counter tăng khi note thay đổi (title/content/delete) — SourcesPanel
   * watch dep này để refetch danh sách notes, giữ list sync với inline view.
   */
  notesVersion: number;
  open: (noteId: string) => void;
  setMode: (mode: NotePreviewMode) => void;
  bumpNotesVersion: () => void;
  close: () => void;
};

const NotePreviewContext = React.createContext<NotePreviewContextValue | null>(
  null,
);

export function useNotePreview(): NotePreviewContextValue | null {
  return React.useContext(NotePreviewContext);
}

export function NotePreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [noteId, setNoteId] = React.useState<string | null>(null);
  const [mode, setModeState] = React.useState<NotePreviewMode>('inline');
  const [notesVersion, setNotesVersion] = React.useState(0);

  const open = React.useCallback((id: string) => {
    setNoteId(id);
    setModeState('inline');
  }, []);

  const setMode = React.useCallback((m: NotePreviewMode) => {
    setModeState(m);
  }, []);

  const bumpNotesVersion = React.useCallback(() => {
    setNotesVersion((v) => v + 1);
  }, []);

  const close = React.useCallback(() => {
    setNoteId(null);
    setModeState('inline');
  }, []);

  const value = React.useMemo<NotePreviewContextValue>(
    () => ({
      noteId,
      mode,
      notesVersion,
      open,
      setMode,
      bumpNotesVersion,
      close,
    }),
    [noteId, mode, notesVersion, open, setMode, bumpNotesVersion, close],
  );

  return (
    <NotePreviewContext.Provider value={value}>
      {children}
    </NotePreviewContext.Provider>
  );
}
