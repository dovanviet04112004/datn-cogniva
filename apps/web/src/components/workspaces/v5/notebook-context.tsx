/**
 * NotebookContext — state quản lý workspace V5 notebook layout.
 *
 * Spec: docs/plans/v5-notebooklm-layout.md §4.1.
 *
 * State:
 *   - `mainView` — view nào đang hiển thị ở panel chính giữa
 *   - `selectedDocs` — Set<documentId> được check trong Sources panel
 *     (scope retrieval / generation). Mặc định: all checked.
 *   - `selectedAtoms` — Set<atomId> được check (scope atom-aware features)
 *
 * KHÔNG quản lý URL state — mainView dùng query param `?view=session`
 * để deep link được. Khi recipe đổi view, push URL kèm.
 */
'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

/** Loại view có thể render ở main panel. */
export type NotebookView =
  | 'chat'         // default — chat workspace
  | 'flashcard'    // Review FC fullscreen
  | 'quiz'         // Quick quiz 5 câu
  | 'atom-guide'   // Markdown study guide
  | 'mind-map'     // Graph viz workspace
  | 'briefing';    // Briefing doc 200-300 từ

/** V8.26: mode hiển thị recipe — 'inline' = Studio sidebar swap; 'modal' = full overlay zoom. */
export type RecipeMode = 'inline' | 'modal';

export type NotebookContextValue = {
  mainView: NotebookView;
  setMainView: (next: NotebookView) => void;
  /** V8.26: mode recipe — default 'inline' khi setMainView. */
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

/** Parse view từ query param, fallback 'chat'. */
function parseView(raw: string | null): NotebookView {
  const valid: NotebookView[] = [
    'chat',
    'flashcard',
    'quiz',
    'atom-guide',
    'mind-map',
    'briefing',
  ];
  return (valid as string[]).includes(raw ?? '') ? (raw as NotebookView) : 'chat';
}

type ProviderProps = {
  children: React.ReactNode;
  /** Document IDs ban đầu — server-fetched, mặc định all checked. */
  initialDocIds: string[];
};

export function NotebookProvider({ children, initialDocIds }: ProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mainView = parseView(searchParams.get('view'));

  // V8.26: recipeMode — state local, mặc định 'inline' (Studio sidebar swap).
  // Zoom button → setRecipeMode('modal') để mở RecipeOverlay full screen.
  // Khi setMainView đổi sang view khác hoặc 'chat' → tự reset 'inline' để
  // lần sau click recipe vào sidebar trước không nhảy thẳng modal.
  const [recipeMode, setRecipeModeState] = React.useState<RecipeMode>('inline');

  const setMainView = React.useCallback(
    (next: NotebookView) => {
      // No-op guard: click cùng view 2 lần không tạo router.replace + state churn.
      if (next === mainView) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'chat') params.delete('view');
      else params.set('view', next);
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
      // Reset mode về 'inline' — modal chỉ kích hoạt khi user click zoom explicit.
      setRecipeModeState('inline');
    },
    [mainView, router, pathname, searchParams],
  );

  const setRecipeMode = React.useCallback((m: RecipeMode) => {
    setRecipeModeState(m);
  }, []);

  // Selected docs — mặc định all checked. Khi initialDocIds đổi (vd
  // upload mới), KHÔNG reset selection — user có thể đã uncheck vài cái.
  const [selectedDocs, setSelectedDocs] = React.useState<Set<string>>(
    () => new Set(initialDocIds),
  );

  // Khi `initialDocIds` thay đổi (doc mới upload), thêm vào selection
  // nhưng KHÔNG remove các đã có (user có thể đã uncheck).
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

  return (
    <NotebookContext.Provider value={value}>{children}</NotebookContext.Provider>
  );
}
