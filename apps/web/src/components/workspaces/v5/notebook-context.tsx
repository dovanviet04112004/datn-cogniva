'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export type NotebookView = 'chat' | 'flashcard' | 'quiz' | 'atom-guide' | 'mind-map' | 'briefing';

export type RecipeMode = 'inline' | 'modal';

export type NotebookContextValue = {
  mainView: NotebookView;
  setMainView: (next: NotebookView) => void;
  recipeMode: RecipeMode;
  setRecipeMode: (m: RecipeMode) => void;
  selectedDocs: Set<string>;
  toggleDoc: (docId: string) => void;
  setAllDocs: (docIds: string[]) => void;
  selectedAtoms: Set<string>;
  toggleAtom: (atomId: string) => void;
};

const NotebookContext = React.createContext<NotebookContextValue | null>(null);

export function useNotebook(): NotebookContextValue {
  const ctx = React.useContext(NotebookContext);
  if (!ctx) {
    throw new Error('useNotebook must be used within <NotebookProvider>');
  }
  return ctx;
}

function parseView(raw: string | null): NotebookView {
  const valid: NotebookView[] = ['chat', 'flashcard', 'quiz', 'atom-guide', 'mind-map', 'briefing'];
  return (valid as string[]).includes(raw ?? '') ? (raw as NotebookView) : 'chat';
}

type ProviderProps = {
  children: React.ReactNode;
  initialDocIds: string[];
};

export function NotebookProvider({ children, initialDocIds }: ProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mainView = parseView(searchParams.get('view'));

  const [recipeMode, setRecipeModeState] = React.useState<RecipeMode>('inline');

  const setMainView = React.useCallback(
    (next: NotebookView) => {
      if (next === mainView) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'chat') params.delete('view');
      else params.set('view', next);
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
      setRecipeModeState('inline');
    },
    [mainView, router, pathname, searchParams],
  );

  const setRecipeMode = React.useCallback((m: RecipeMode) => {
    setRecipeModeState(m);
  }, []);

  const [selectedDocs, setSelectedDocs] = React.useState<Set<string>>(() => new Set(initialDocIds));

  const initialDocIdsKey = initialDocIds.join(',');
  React.useEffect(() => {
    setSelectedDocs((cur) => {
      const next = new Set(cur);
      let changed = false;
      for (const id of initialDocIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [initialDocIdsKey, initialDocIds]);

  const toggleDoc = React.useCallback((docId: string) => {
    setSelectedDocs((cur) => {
      const next = new Set(cur);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  const setAllDocs = React.useCallback((docIds: string[]) => {
    setSelectedDocs(new Set(docIds));
  }, []);

  const [selectedAtoms, setSelectedAtoms] = React.useState<Set<string>>(new Set());

  const toggleAtom = React.useCallback((atomId: string) => {
    setSelectedAtoms((cur) => {
      const next = new Set(cur);
      if (next.has(atomId)) next.delete(atomId);
      else next.add(atomId);
      return next;
    });
  }, []);

  const value = React.useMemo<NotebookContextValue>(
    () => ({
      mainView,
      setMainView,
      recipeMode,
      setRecipeMode,
      selectedDocs,
      toggleDoc,
      setAllDocs,
      selectedAtoms,
      toggleAtom,
    }),
    [
      mainView,
      setMainView,
      recipeMode,
      setRecipeMode,
      selectedDocs,
      toggleDoc,
      setAllDocs,
      selectedAtoms,
      toggleAtom,
    ],
  );

  return <NotebookContext.Provider value={value}>{children}</NotebookContext.Provider>;
}
