/**
 * FlashcardView — V5 recipe "Ôn flashcard" embedded.
 *
 * V8.10 (2026-05-20): switch từ `<ReviewSession>` của trang `/flashcards/review`
 * cũ sang `<FlashcardSessionV8>` — UI redesign hợp với workspace embed.
 *
 * V8.25 (2026-05-20): render trong modal RecipeOverlay — bỏ header "Quay lại
 * chat" (redundant, modal đã có X close). Chỉ giữ title chip nhỏ.
 *
 * Spec gốc: docs/plans/v5-notebooklm-layout.md §5.
 */
'use client';

import { BrainCircuit } from 'lucide-react';

import { FlashcardSessionV8 } from './flashcard-session-v8';

export function FlashcardView({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b bg-muted/20 px-4 py-2 pr-12">
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <BrainCircuit className="h-3 w-3 text-primary" />
          Ôn flashcard · scope workspace
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <FlashcardSessionV8 workspaceId={workspaceId} />
      </div>
    </div>
  );
}
