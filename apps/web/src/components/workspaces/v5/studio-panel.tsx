/**
 * StudioPanel — cột phải V5 workspace notebook.
 *
 * Spec: docs/plans/v5-notebooklm-layout.md §4.4.
 *
 * Stack 3 nhóm recipes:
 *   - HÔM NAY (priority): Phiên 15 phút, Quick review
 *   - GENERATE: Flashcard, Quiz, Exam (custom)
 *   - VIEW: Atom guide, Mind map, Briefing doc
 *
 * Click recipe → setMainView(view) trong context → main panel swap.
 * Recipe nào chưa build (V5.2-V5.3) → main panel render placeholder.
 */
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

/**
 * Recipe action types:
 *   - `view`: swap mainView (default — embedded view trong MainPanel)
 *   - `href`: navigate external link (rời workspace)
 *   - `actionId`: trigger handler riêng ở parent (vd open modal in-workspace)
 */
type RecipeActionId = 'openExamManager';

/**
 * V8.27: `labelKey` + `hintKey` + group `titleKey` lưu i18n key, render qua
 * `useT()` để tự động theo locale vi/en chọn ở Settings.
 */
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
    // "Tạo" — flashcard / quiz / đề thi. Bỏ recipe "Phiên 15 phút" (auto) — giờ
    // user TỰ chọn atom bên trái rồi tạo, không còn auto-recommend.
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
  /** V8.10: pass để CreateExamDialog gắn exam vào workspace. */
  workspaceId?: string;
};

export function StudioPanel({ workspaceId }: StudioProps = {}) {
  const { mainView, setMainView } = useNotebook();
  const examPreview = useExamPreview();
  const t = useT();
  /** showExamManager = Studio swap sang ExamManager (list + tạo). */
  const [showExamManager, setShowExamManager] = React.useState(false);

  const handleAction = (actionId: RecipeActionId) => {
    if (actionId === 'openExamManager') setShowExamManager(true);
  };

  // V8.26 conditional render priority:
  //   1. examPreview.mode='inline' → exam inline preview (V8.24)
  //   2. showExamManager → exam list manager (V8.23)
  //   3. mainView != 'chat' → recipe-specific sidebar preview (V8.26)
  //   4. default → recipes list (entry)
  if (examPreview?.examId && examPreview.mode === 'inline') {
    return <StudioExamInlinePreview />;
  }
  if (showExamManager && workspaceId) {
    return (
      <StudioExamManager
        workspaceId={workspaceId}
        onBack={() => setShowExamManager(false)}
      />
    );
  }
  // V8.26: 6 recipe non-Exam render sidebar preview thay vì swap main panel
  // hoặc nhảy thẳng modal. User cần xem stats / management ở sidebar trước,
  // bấm zoom (Maximize2) → setRecipeMode('modal') mới mở overlay full.
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
    <aside className="flex h-full flex-col overflow-hidden border-l bg-card">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-primary" />
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('studio.title')}
          </h2>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-2.5">
        {GROUPS.map((group) => (
          <section key={group.titleKey} className="mb-4 last:mb-0">
            <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
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
          <p
            className={cn(
              'truncate text-[13px] font-medium',
              active && 'text-primary',
            )}
          >
            {t(recipe.labelKey)}
          </p>
          {recipe.badge && (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
              {recipe.badge}
            </span>
          )}
          {recipe.soon && (
            <span className="shrink-0 rounded bg-warning/10 px-1 py-0.5 text-[10px] font-semibold text-warning">
              Soon
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
          {t(recipe.hintKey)}
        </p>
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
