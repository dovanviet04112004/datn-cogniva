'use client';

import * as React from 'react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useNotebook } from './notebook-context';
import { FlashcardView } from './views/flashcard-view';
import { QuickQuizView } from './views/quick-quiz-view';
import { AtomGuideView } from './views/atom-guide-view';
import { MindMapView } from './views/mind-map-view';
import { BriefingView } from './views/briefing-view';

const RECIPE_TITLES: Record<string, string> = {
  flashcard: 'Ôn flashcard',
  quiz: 'Quick Quiz',
  'atom-guide': 'Atom Guide',
  'mind-map': 'Mind map',
  briefing: 'Briefing doc',
};

export function RecipeOverlay({ workspaceId }: { workspaceId: string }) {
  const { mainView, recipeMode, setRecipeMode } = useNotebook();
  const open = mainView !== 'chat' && recipeMode === 'modal';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setRecipeMode('inline');
      }}
    >
      <DialogContent className="flex h-[92vh] w-[92vw] max-w-[1400px] flex-col gap-0 overflow-hidden rounded-2xl p-0">
        <DialogTitle className="sr-only">{RECIPE_TITLES[mainView] ?? 'Recipe'}</DialogTitle>

        <div className="min-h-0 flex-1 overflow-hidden">
          {mainView === 'flashcard' && <FlashcardView workspaceId={workspaceId} />}
          {mainView === 'quiz' && <QuickQuizView workspaceId={workspaceId} />}
          {mainView === 'atom-guide' && <AtomGuideView workspaceId={workspaceId} />}
          {mainView === 'mind-map' && <MindMapView workspaceId={workspaceId} />}
          {mainView === 'briefing' && <BriefingView workspaceId={workspaceId} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
