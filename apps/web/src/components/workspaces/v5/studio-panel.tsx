'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  BrainCircuit,
  ClipboardList,
  FileText,
  ListChecks,
  Map,
  Network,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import { useExamPreview } from './exam-preview-context';
import { StudioExamInlinePreview } from './studio-exam-inline-preview';
import { StudioExamManager } from './studio-exam-manager';
import {
  StudioFlashcardPreview,
  StudioQuizPreview,
  StudioAtomGuidePreview,
  StudioMindMapPreview,
  StudioBriefingPreview,
} from './studio-recipe-previews';
import { useNotebook, type NotebookView } from './notebook-context';

type RecipeActionId = 'openExamManager';

type Recipe = {
  view: NotebookView | null;
  icon: LucideIcon;
  labelKey: string;
  hintKey: string;
  badge?: string;
  href?: string;
  actionId?: RecipeActionId;
  soon?: boolean;
};

type Group = {
  titleKey: string;
  recipes: Recipe[];
};

const GROUPS: Group[] = [
  {
    titleKey: 'studio.group.generate',
    recipes: [
      {
        view: 'flashcard',
        icon: BrainCircuit,
        labelKey: 'recipe.flashcard',
        hintKey: 'recipe.flashcard.hint',
      },
      {
        view: 'quiz',
        icon: ListChecks,
        labelKey: 'recipe.quiz',
        hintKey: 'recipe.quiz.hint',
      },
      {
        view: null,
        icon: ClipboardList,
        labelKey: 'recipe.exam',
        hintKey: 'recipe.exam.hint',
        actionId: 'openExamManager',
      },
    ],
  },
  {
    titleKey: 'studio.group.view',
    recipes: [
      {
        view: 'atom-guide',
        icon: FileText,
        labelKey: 'recipe.atom_guide',
        hintKey: 'recipe.atom_guide.hint',
      },
      {
        view: 'mind-map',
        icon: Network,
        labelKey: 'recipe.mind_map',
        hintKey: 'recipe.mind_map.hint',
      },
      {
        view: 'briefing',
        icon: Map,
        labelKey: 'recipe.briefing',
        hintKey: 'recipe.briefing.hint',
      },
    ],
  },
];

type StudioProps = {
  workspaceId?: string;
};

export function StudioPanel({ workspaceId }: StudioProps = {}) {
  const { mainView, setMainView } = useNotebook();
  const examPreview = useExamPreview();
  const t = useT();
  const [showExamManager, setShowExamManager] = React.useState(false);

  const handleAction = (actionId: RecipeActionId) => {
    if (actionId === 'openExamManager') setShowExamManager(true);
  };

  if (examPreview?.examId && examPreview.mode === 'inline') {
    return <StudioExamInlinePreview />;
  }
  if (showExamManager && workspaceId) {
    return <StudioExamManager workspaceId={workspaceId} onBack={() => setShowExamManager(false)} />;
  }
  if (mainView !== 'chat' && workspaceId) {
    switch (mainView) {
      case 'flashcard':
        return <StudioFlashcardPreview workspaceId={workspaceId} />;
      case 'quiz':
        return <StudioQuizPreview workspaceId={workspaceId} />;
      case 'atom-guide':
        return <StudioAtomGuidePreview workspaceId={workspaceId} />;
      case 'mind-map':
        return <StudioMindMapPreview workspaceId={workspaceId} />;
      case 'briefing':
        return <StudioBriefingPreview workspaceId={workspaceId} />;
    }
  }

  return (
    <aside className="bg-card flex h-full flex-col overflow-hidden border-l">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="text-primary h-3 w-3" />
          <h2 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
            {t('studio.title')}
          </h2>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-2.5">
        {GROUPS.map((group) => (
          <section key={group.titleKey} className="mb-4 last:mb-0">
            <h3 className="text-muted-foreground/80 mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider">
              {t(group.titleKey)}
            </h3>
            <ul className="space-y-1">
              {group.recipes.map((r) => (
                <RecipeCard
                  key={r.labelKey}
                  recipe={r}
                  active={r.view !== null && mainView === r.view}
                  onClick={() => {
                    if (r.actionId) handleAction(r.actionId);
                    else if (r.view) setMainView(r.view);
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

function RecipeCard({
  recipe,
  active,
  onClick,
}: {
  recipe: Recipe;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = recipe.icon;
  const t = useT();

  const inner = (
    <div
      className={cn(
        'group flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-all',
        active
          ? 'border-primary/40 bg-primary/5 shadow-sm'
          : 'border-divider bg-card hover:border-primary/30 hover:bg-primary/5',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          active ? 'text-primary' : 'text-muted-foreground group-hover:text-primary',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5">
          <p className={cn('truncate text-[13px] font-medium', active && 'text-primary')}>
            {t(recipe.labelKey)}
          </p>
          {recipe.badge && (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 py-0.5 font-mono text-[10px]">
              {recipe.badge}
            </span>
          )}
          {recipe.soon && (
            <span className="bg-warning/10 text-warning shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold">
              Soon
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px]">{t(recipe.hintKey)}</p>
      </div>
    </div>
  );

  if (recipe.href) {
    return (
      <li>
        <Link href={recipe.href}>{inner}</Link>
      </li>
    );
  }

  return (
    <li>
      <button onClick={onClick} className="w-full text-left">
        {inner}
      </button>
    </li>
  );
}
