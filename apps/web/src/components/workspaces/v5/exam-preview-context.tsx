'use client';

import * as React from 'react';

export type ExamPreviewMode = 'inline' | 'modal';

export type ExamPreviewContextValue = {
  examId: string | null;
  mode: ExamPreviewMode;
  examsVersion: number;
  open: (examId: string) => void;
  setMode: (mode: ExamPreviewMode) => void;
  close: () => void;
  bumpExamsVersion: () => void;
};

const ExamPreviewContext = React.createContext<ExamPreviewContextValue | null>(null);

export function useExamPreview(): ExamPreviewContextValue | null {
  return React.useContext(ExamPreviewContext);
}

export function ExamPreviewProvider({ children }: { children: React.ReactNode }) {
  const [examId, setExamId] = React.useState<string | null>(null);
  const [mode, setModeState] = React.useState<ExamPreviewMode>('inline');
  const [examsVersion, setExamsVersion] = React.useState(0);

  const open = React.useCallback((id: string) => {
    setExamId(id);
    setModeState('inline');
  }, []);
  const setMode = React.useCallback((m: ExamPreviewMode) => setModeState(m), []);
  const close = React.useCallback(() => {
    setExamId(null);
    setModeState('inline');
  }, []);
  const bumpExamsVersion = React.useCallback(() => setExamsVersion((v) => v + 1), []);

  const value = React.useMemo<ExamPreviewContextValue>(
    () => ({
      examId,
      mode,
      examsVersion,
      open,
      setMode,
      close,
      bumpExamsVersion,
    }),
    [examId, mode, examsVersion, open, setMode, close, bumpExamsVersion],
  );

  return <ExamPreviewContext.Provider value={value}>{children}</ExamPreviewContext.Provider>;
}
