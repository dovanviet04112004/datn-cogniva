'use client';

import * as React from 'react';

export type NotePreviewMode = 'inline' | 'modal';

export type NotePreviewContextValue = {
  noteId: string | null;
  mode: NotePreviewMode;
  notesVersion: number;
  open: (noteId: string) => void;
  setMode: (mode: NotePreviewMode) => void;
  bumpNotesVersion: () => void;
  close: () => void;
};

const NotePreviewContext = React.createContext<NotePreviewContextValue | null>(null);

export function useNotePreview(): NotePreviewContextValue | null {
  return React.useContext(NotePreviewContext);
}

export function NotePreviewProvider({ children }: { children: React.ReactNode }) {
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

  return <NotePreviewContext.Provider value={value}>{children}</NotePreviewContext.Provider>;
}
